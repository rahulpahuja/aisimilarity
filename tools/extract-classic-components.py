#!/usr/bin/env python3
"""One-off migration: extract the legacy hand-written comparison tables from the
old index.html into data/components-classic.json (Android Views / UIKit era).
Kept in tools/ for reproducibility; the JSON is the source of truth afterwards."""
import json, sys
from html.parser import HTMLParser

COLS = ["android", "ios", "react_native", "flutter", "xamarin", "ionic"]
CLASS_TO_KEY = {"table-head-android": "android", "table-head-ios": "ios",
                "table-head-react": "react_native", "table-head-flutter": "flutter",
                "table-head-x": "xamarin", "table-head-ionic": "ionic"}

class P(HTMLParser):
    def __init__(self):
        super().__init__()
        self.groups = []; self.cur = None; self.row = None; self.cell = None
        self.in_caption = False; self.in_label = False; self.in_tbody = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "table": self.cur = {"id": a.get("id", ""), "label": "", "items": []}
        elif tag == "caption": self.in_caption = True
        elif tag == "tbody": self.in_tbody = True
        elif tag == "tr" and self.in_tbody: self.row = {"component": "", "links": {}}
        elif tag == "td" and self.row is not None:
            cls = (a.get("class") or "").split()
            key = next((CLASS_TO_KEY[c] for c in cls if c in CLASS_TO_KEY), "component" if "table-head-component" in cls else None)
            self.cell = {"key": key, "text": "", "href": None}
        elif tag == "a" and self.cell is not None: self.cell["href"] = a.get("href")
    def handle_endtag(self, tag):
        if tag == "caption": self.in_caption = False
        elif tag == "td" and self.cell is not None and self.row is not None:
            c = self.cell; t = " ".join(c["text"].split())
            if c["key"] == "component": self.row["component"] = t
            elif c["key"]:
                self.row[c["key"]] = None if t.lower() in ("not applicable", "n/a", "") else t
                if c["href"]: self.row["links"][c["key"]] = c["href"]
            self.cell = None
        elif tag == "tr" and self.row is not None:
            if self.row["component"] and self.cur is not None: self.cur["items"].append(self.row)
            self.row = None
        elif tag == "tbody": self.in_tbody = False
        elif tag == "table" and self.cur is not None: self.groups.append(self.cur); self.cur = None
    def handle_data(self, d):
        if self.in_caption and self.cur is not None: self.cur["label"] += d
        if self.cell is not None: self.cell["text"] += d

src = sys.argv[1]
p = P(); p.feed(open(src, encoding="utf-8").read())
groups = []
for g in p.groups:
    g["label"] = " ".join(g["label"].split())
    g["id"] = g["id"].replace("table-data-", "")
    for it in g["items"]:
        for k in COLS: it.setdefault(k, None)
    groups.append(g)
out = {"meta": {"description": "Classic (Android Views / UIKit) cross-framework component mappings, migrated from the original home-page tables.",
                "platformKeys": {"android": "Android Views/XML", "ios": "UIKit"}},
       "groups": groups}
json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print({g["id"]: len(g["items"]) for g in groups})
