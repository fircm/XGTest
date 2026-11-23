import json, collections
data = json.load(open("questions.json", encoding="utf-8"))
print("total:", len(data))
chapters = collections.Counter(q["chapter"] for q in data)
print("chapters:", len(chapters))
for c, n in sorted(chapters.items()):
    print(f"  {n:3d}  {c}")

bad = []
for q in data:
    labels = [o["label"] for o in q["options"]]
    if labels != ["A","B","C","D"]:
        bad.append((q["id"], "labels", labels))
    if not q["question"].strip():
        bad.append((q["id"], "empty q"))
    for o in q["options"]:
        if not o["text"].strip():
            bad.append((q["id"], "empty opt", o["label"]))
    ans = q["answer"]
    if q["type"] == "single":
        if ans not in "ABCD" or len(ans) != 1:
            bad.append((q["id"], "single answer", ans))
    else:
        s = set(ans)
        if not s or not s.issubset(set("ABCD")) or len(s) != len(ans) or len(ans) < 2:
            bad.append((q["id"], "multi answer", ans))
    # answer must correspond to existing options (all answer labels in options)
    if not set(ans).issubset(set(labels)):
        bad.append((q["id"], "answer not in options", ans, labels))

print("\ndata issues:", len(bad))
for b in bad[:20]:
    print("  ", b)

# type counts
print("single:", sum(1 for q in data if q["type"]=="single"), "multi:", sum(1 for q in data if q["type"]=="multi"))
# sample
print("\nsample single:", json.dumps(data[0], ensure_ascii=False)[:300])
print("sample multi:", json.dumps([q for q in data if q["type"]=="multi"][0], ensure_ascii=False)[:300])
