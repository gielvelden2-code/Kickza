#!/usr/bin/env python3
"""Build Kickza news metadata from public publisher RSS feeds. No full articles copied."""
import datetime, email.utils, json, os, re, urllib.request, xml.etree.ElementTree as ET
from html import unescape
from urllib.parse import urlparse

FEEDS = [
 ("BBC Sport", "https://feeds.bbci.co.uk/sport/football/rss.xml"),
 ("Sky Sports", "https://www.skysports.com/rss/11095"),
 ("Sky Premier League", "https://www.skysports.com/rss/11661"),
 ("Google Nieuws NL", "https://news.google.com/rss/search?q=voetbal+transfers+OR+persconferentie+OR+trainer+when%3A2d&hl=nl&gl=NL&ceid=NL%3Anl"),
 ("Google Nieuws Transfers", "https://news.google.com/rss/search?q=voetbal+transfers+when%3A2d&hl=nl&gl=NL&ceid=NL%3Anl"),
]
HEADERS={"User-Agent":"KickzaNewsReader/1.0 (+https://gielvelden2-code.github.io/Kickza/) Mozilla/5.0"}
def clean(value):
    return re.sub(r"\\s+", " ", re.sub(r"<[^>]+>", " ", unescape(value or ""))).strip()
def parse_date(value):
    try:
        dt=email.utils.parsedate_to_datetime(value)
        return dt.astimezone(datetime.timezone.utc).isoformat()
    except (TypeError,ValueError,OverflowError,IndexError):
        return ""
articles=[]
seen=set()
for source,url in FEEDS:
    try:
        req=urllib.request.Request(url,headers=HEADERS)
        with urllib.request.urlopen(req,timeout=18) as response:
            root=ET.fromstring(response.read(2500000))
        for item in root.findall(".//item"):
            title=clean(item.findtext("title"))
            link=(item.findtext("link") or "").strip()
            if not title or not link or urlparse(link).scheme not in ("http","https"):
                continue
            key=title.lower()
            if key in seen:continue
            seen.add(key)
            description=clean(item.findtext("description"))[:240]
            date=parse_date(item.findtext("pubDate"))
            image=""
            for element in item:
                tag=element.tag.rsplit("}",1)[-1].lower()
                if tag in ("thumbnail","content","enclosure"):
                    candidate=element.attrib.get("url","")
                    if candidate.startswith("https://") and re.search(r"\\.(jpe?g|png|webp)(\\?|$)",candidate,re.I):
                        image=candidate;break
            articles.append(dict(title=title,link=link,description=description,source=source,pubDate=date,image=image))
    except Exception as exc:
        print("Feed failed:",source,str(exc)[:180])
articles.sort(key=lambda a:a["pubDate"],reverse=True)
path="data/news.json"
os.makedirs("data",exist_ok=True)
# Keep previously fetched articles if every upstream feed temporarily fails.
if not articles and os.path.exists(path):
    print("No fresh feeds: keeping last good news snapshot")
else:
    with open(path,"w",encoding="utf-8") as f:
        json.dump(dict(updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),articles=articles[:80]),f,ensure_ascii=False,indent=2)
print("News articles:",len(articles))
