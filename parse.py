import docx, os, re, glob, json

SRC = "raw_data"
OUT = "questions.json"

def parse_file(path):
    name = os.path.basename(path)
    chapter = re.sub(r'题库\.docx$', '', name)
    doc = docx.Document(path)
    # 去除段落内的软换行（Word 中 shift+enter 产生的 \n），避免题干被截断或正则锚点失效
    paras = [p.text.strip().replace('\n', '').replace('\r', '') for p in doc.paragraphs]

    # locate section markers by exact normalized match
    def find_idx(keyword):
        for i, t in enumerate(paras):
            if t == keyword:
                return i
        return -1

    i_single = find_idx("一、单项选择题")
    i_multi = find_idx("二、多项选择题")
    i_ans = find_idx("三、参考答案")
    assert i_single >= 0 and i_multi > i_single and i_ans > i_multi, f"bad markers in {name}"

    q_re = re.compile(r'^(\d+)[．.]\s*(.*)$')
    opt_re = re.compile(r'^([A-Z])[．.]\s*(.*)$')

    def parse_block(lines):
        questions = []
        cur = None
        for ln in lines:
            if not ln:
                continue
            mq = q_re.match(ln)
            mo = opt_re.match(ln)
            if mq:
                if cur:
                    questions.append(cur)
                cur = {"no": int(mq.group(1)), "q": mq.group(2), "options": []}
            elif mo and cur is not None:
                cur["options"].append({"label": mo.group(1), "text": mo.group(2)})
            elif cur is not None:
                # continuation of question stem
                cur["q"] += ln
        if cur:
            questions.append(cur)
        return questions

    single = parse_block(paras[i_single+1:i_multi])
    multi = parse_block(paras[i_multi+1:i_ans])

    # answers from tables: table0 single, table1 multi
    def answers_from_table(tbl):
        rows = [[c.text.strip() for c in r.cells] for r in tbl.rows]
        assert len(rows) >= 2, f"table too short in {name}"
        nums = rows[0][1:]
        ans = rows[1][1:]
        d = {}
        for n, a in zip(nums, ans):
            if n.isdigit():
                d[int(n)] = a.strip()
        return d

    sa = answers_from_table(doc.tables[0])
    ma = answers_from_table(doc.tables[1])

    out = []
    for q in single:
        a = sa.get(q["no"], "")
        out.append({
            "chapter": chapter,
            "type": "single",
            "no": q["no"],
            "question": q["q"],
            "options": q["options"],
            "answer": a,
        })
    for q in multi:
        a = ma.get(q["no"], "")
        out.append({
            "chapter": chapter,
            "type": "multi",
            "no": q["no"],
            "question": q["q"],
            "options": q["options"],
            "answer": a,
        })
    return out, single, multi, sa, ma

all_q = []
total_single = total_multi = 0
errors = []
for f in sorted(glob.glob(SRC + "/*.docx")):
    name = os.path.basename(f)
    try:
        qs, single, multi, sa, ma = parse_file(f)
        # validate
        ok = True
        if len(single) != len(sa):
            errors.append(f"{name}: single parsed {len(single)} vs answers {len(sa)}"); ok=False
        if len(multi) != len(ma):
            errors.append(f"{name}: multi parsed {len(multi)} vs answers {len(ma)}"); ok=False
        # every question must have 4 options and an answer
        for q in qs:
            if len(q["options"]) != 4:
                errors.append(f"{name} {q['type']}#{q['no']}: options={len(q['options'])}")
            if not q["answer"]:
                errors.append(f"{name} {q['type']}#{q['no']}: missing answer")
        total_single += len(single)
        total_multi += len(multi)
        all_q.extend(qs)
        print(f"[{'OK' if ok else 'WARN'}] {name}: 单选{len(single)} 多选{len(multi)}")
    except Exception as e:
        errors.append(f"{name}: EXCEPTION {e}")
        print(f"[ERR] {name}: {e}")

print()
print(f"总计: {len(all_q)} 题 (单选 {total_single} + 多选 {total_multi})")
if errors:
    print("\n!!! 校验问题:")
    for e in errors:
        print("  -", e)
else:
    print("\n校验全部通过: 题数匹配、每题4个选项、答案齐全")

# assign global ids
for i, q in enumerate(all_q, 1):
    q["id"] = i

with open(OUT, "w", encoding="utf-8") as fp:
    json.dump(all_q, fp, ensure_ascii=False, indent=2)
print(f"\n已写入 {OUT}")
