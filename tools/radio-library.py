#!/usr/bin/env python
"""Библиотека музыки для радио Pip-Boy.

    python tools/radio-library.py fetch [--root D:/FOnline/radio-library]
    python tools/radio-library.py build [--root ...] [--out public/radio]

`fetch` скачивает исходники в <root>/raw/<source>/ и пишет <root>/raw/index.json:
  * commons  — Викисклад, категория «Audio files of music of the Soviet Union»
               (+ подкатегории) и Katyusha sample.ogg; лицензия из extmetadata.
  * mrcsf    — archive.org, коллекция mrcsf-music (Музей русской культуры,
               Сан-Франциско; пластинки 1901–1930-х; на карточках CC BY-NC-ND).
  * great78  — archive.org, Great 78 Project (George Blood): советские пластинки
               1930–1950-х; лицензия на карточках не указана.
  * pixabay / itch — роялти-фри стилизации, кладутся вручную в raw/pixabay и
               raw/itch (Pixabay и itch.io закрыты от curl); метаданные из
               raw/<source>/manifest.json, если он есть.

`build` перекодирует всё в моно MP3 64 kbps (22.05 кГц) в <out>/ и пишет
<out>/manifest.json с каналами, названием, исполнителем, годом, источником и
лицензией. Каналы назначаются эвристикой по названию/исполнителю; каждый трек
попадает хотя бы в один канал. Каталог public/radio/ генерируется, в git не входит.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed

USER_AGENT = "RealmOfAshesRadio/1.0 (https://github.com/MrHab; radio library fetcher)"
IA_GREAT78_QUERY = (
    "collection:georgeblood AND (Aprelevka OR Апрелевский OR Melodiya OR Мелодия OR Soviet "
    "OR СССР OR Utesov OR Alexandrov OR Shulzhenko OR Lemeshev)"
)
COMMONS_CATEGORIES = ["Category:Audio_files_of_music_of_the_Soviet_Union"]
COMMONS_EXTRA_FILES = ["File:Katyusha sample.ogg"]
AUDIO_EXT = (".mp3", ".ogg", ".oga", ".flac", ".wav", ".opus", ".m4a")


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def http_json(url, retries=4):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            log("retry %s: %s" % (url, exc))
            time.sleep(2 * (attempt + 1))


def download(url, dest, expected_size=None, retries=4):
    if os.path.exists(dest) and (expected_size is None or os.path.getsize(dest) == int(expected_size)):
        return False
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
                while True:
                    chunk = resp.read(1 << 16)
                    if not chunk:
                        break
                    out.write(chunk)
            os.replace(tmp, dest)
            return True
        except Exception as exc:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            log("retry %s: %s" % (url, exc))
            time.sleep(3 * (attempt + 1))


# ----------------------------------------------------------------------------
# fetch
# ----------------------------------------------------------------------------

def commons_query(params):
    base = "https://commons.wikimedia.org/w/api.php?"
    params = dict(params, format="json", formatversion="2")
    return http_json(base + urllib.parse.urlencode(params))


def commons_category_files(category, seen, out):
    """Рекурсивно собирает файлы категории и подкатегорий."""
    if category in seen:
        return
    seen.add(category)
    cont = {}
    while True:
        data = commons_query(dict(action="query", list="categorymembers", cmtitle=category,
                                  cmtype="file|subcat", cmlimit="500", **cont))
        for member in data["query"]["categorymembers"]:
            title = member["title"]
            if title.startswith("Category:"):
                commons_category_files(title, seen, out)
            elif title.lower().endswith(AUDIO_EXT):
                out.append(title)
        if "continue" not in data:
            break
        cont = data["continue"]


def fetch_commons(root):
    files = []
    seen = set()
    for category in COMMONS_CATEGORIES:
        commons_category_files(category, seen, files)
    for extra in COMMONS_EXTRA_FILES:
        if extra not in files:
            files.append(extra)
    log("commons: %d файлов" % len(files))
    entries = []
    for i in range(0, len(files), 20):
        batch = files[i:i + 20]
        data = commons_query(dict(action="query", titles="|".join(batch), prop="imageinfo",
                                  iiprop="url|size|extmetadata"))
        for page in data["query"]["pages"]:
            info = (page.get("imageinfo") or [None])[0]
            if not info:
                continue
            meta = info.get("extmetadata", {})
            name = page["title"].split(":", 1)[1]
            dest = os.path.join(root, "raw", "commons", name)
            download(info["url"], dest, info.get("size"))
            entries.append({
                "source": "commons",
                "id": name,
                "title": strip_html(meta.get("ObjectName", {}).get("value") or os.path.splitext(name)[0]),
                "creator": strip_html(meta.get("Artist", {}).get("value", "")),
                "date": strip_html(meta.get("DateTimeOriginal", {}).get("value", "")),
                "description": strip_html(meta.get("ImageDescription", {}).get("value", ""))[:400],
                "license": strip_html(meta.get("LicenseShortName", {}).get("value", "")),
                "licenseUrl": strip_html(meta.get("LicenseUrl", {}).get("value", "")),
                "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(page["title"].replace(" ", "_")),
                "files": [os.path.join("commons", name)],
            })
            log("commons ✓ " + name)
    return entries


def strip_html(text):
    return re.sub(r"<[^>]+>", "", text or "").strip()


def safe_name(name):
    """Имя файла, допустимое на Windows: кавычки, `?`, `:` и прочее → `_`."""
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .") or "track"


def ia_search(query):
    url = "https://archive.org/advancedsearch.php?" + urllib.parse.urlencode({
        "q": query, "fl[]": "identifier", "rows": "2000", "output": "json"})
    data = http_json(url)
    return [doc["identifier"] for doc in data["response"]["docs"]]


def ia_item(root, source, identifier):
    meta = http_json("https://archive.org/metadata/" + identifier)
    md = meta.get("metadata", {})
    files = []
    for f in meta.get("files", []):
        if f.get("format") != "VBR MP3":
            continue
        rel = os.path.join(source, identifier, safe_name(f["name"]))
        url = "https://archive.org/download/%s/%s" % (identifier, urllib.parse.quote(f["name"]))
        download(url, os.path.join(root, "raw", rel), f.get("size"))
        files.append({"path": rel, "title": f.get("title") or "", "size": int(f.get("size") or 0)})
    creator = md.get("creator", "")
    if isinstance(creator, list):
        creator = ", ".join(creator)
    return {
        "source": source,
        "id": identifier,
        "title": strip_html(str(md.get("title", ""))),
        "creator": strip_html(str(creator)),
        "date": str(md.get("date", "")),
        "description": strip_html(str(md.get("description", "")))[:400],
        "license": "",
        "licenseUrl": md.get("licenseurl", "") or "",
        "page": "https://archive.org/details/" + identifier,
        "files": files,
    }


def fetch_ia(root, source, query, workers=6):
    ids = ia_search(query)
    log("%s: %d элементов" % (source, len(ids)))
    entries = []
    failed = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(ia_item, root, source, i): i for i in ids}
        for n, fut in enumerate(as_completed(futures), 1):
            identifier = futures[fut]
            try:
                entry = fut.result()
                entries.append(entry)
                log("%s ✓ %d/%d %s (%d mp3)" % (source, n, len(ids), identifier, len(entry["files"])))
            except Exception as exc:  # noqa: BLE001
                failed.append(identifier)
                log("%s ✗ %s: %s" % (source, identifier, exc))
    if failed:
        log("%s: не скачано %d: %s" % (source, len(failed), ", ".join(failed)))
    entries.sort(key=lambda e: e["id"])
    return entries


def fetch_manual(root, source):
    """Ручные папки (pixabay, itch): аудиофайлы + опциональный manifest.json."""
    folder = os.path.join(root, "raw", source)
    if not os.path.isdir(folder):
        return []
    manifest = {}
    mpath = os.path.join(folder, "manifest.json")
    if os.path.exists(mpath):
        with open(mpath, encoding="utf-8") as fh:
            manifest = {row["file"]: row for row in json.load(fh)}
    entries = []
    for name in sorted(os.listdir(folder)):
        if not name.lower().endswith(AUDIO_EXT):
            continue
        row = manifest.get(name, {})
        entries.append({
            "source": source,
            "id": os.path.splitext(name)[0],
            "title": row.get("title") or os.path.splitext(name)[0],
            "creator": row.get("creator", ""),
            "date": row.get("date", ""),
            "description": row.get("description", ""),
            "license": row.get("license", ""),
            "licenseUrl": row.get("licenseUrl", ""),
            "page": row.get("page", ""),
            "files": [os.path.join(source, name)],
        })
    return entries


def cmd_fetch(args):
    root = args.root
    os.makedirs(os.path.join(root, "raw"), exist_ok=True)
    sources = args.sources.split(",") if args.sources else ["commons", "mrcsf", "great78"]
    index_path = os.path.join(root, "raw", "index.json")
    index = {}
    if os.path.exists(index_path):
        with open(index_path, encoding="utf-8") as fh:
            index = json.load(fh)
    for source in sources:
        if source == "commons":
            index["commons"] = fetch_commons(root)
        elif source == "mrcsf":
            index["mrcsf"] = fetch_ia(root, "mrcsf", "collection:mrcsf-music")
        elif source == "great78":
            index["great78"] = fetch_ia(root, "great78", IA_GREAT78_QUERY)
        else:
            raise SystemExit("неизвестный источник: " + source)
        with open(index_path, "w", encoding="utf-8") as fh:
            json.dump(index, fh, ensure_ascii=False, indent=1)
    log("index → " + index_path)


# ----------------------------------------------------------------------------
# build
# ----------------------------------------------------------------------------

CHANNEL_BEACON, CHANNEL_ASH, CHANNEL_SAFETY = "beacon", "ash", "safety"

SAFETY_WORDS = [
    "march", "марш", "red army", "red-army", "red banner", "soviet army", "alexandrov", "ensemble of red army",
    "anthem", "гимн", "hymn", "war", "войн", "tachanka", "тачанка", "tank", "victory", "front", "фронт", "battle",
    "cossack", "казак", "cavalry", "artillery", "military", "commissariat of defense", "chorus of the u.s.s.r",
    "red army choir", "nurse", "partisan", "партизан", "partyz", "stalin", "сталин", "border", "aviator",
    "stallions of steel", "from border to border", "if war breaks", "salute the soviet", "along the vales",
    "along valleys", "polushko", "polushka", "meadowland", "svyaschennaya", "священная", "25th anniversary",
    "song and dance ensemble", "military chorus", "brave don", "forward to victory", "sebastopol", "tractor song",
    "hammer and sickle", "for the motherland",
]
ASH_WORDS = [
    "romance", "романс", "aria", "ария", "opera", "опер", "shostakovich", "шостакович", "radio", "радио",
    "chaliapin", "schaliapin", "шаляпин", "lemeshev", "лемешев", "kozin", "козин", "shulzhenko", "шульженко",
    "leshtchenko", "лещенко", "vyaltseva", "вяльцева", "smirnova", "waltz", "вальс", "sorrow", "night", "ноч",
    "fog", "moon", "луна", "tchaikovsky", "borodin", "dargomyzhsky", "rachmaninoff", "rachi", "glinka",
    "mist", "снежн", "snow", "swan", "at night", "alone on the road", "lubov", "liubov", "love", "любов",
    "heart", "сердц", "tenor", "soprano", "baritone", "bass", "orchestra of the", "symphon", "bolshoi", "philharmonic",
    "1900", "1901", "1902", "1903", "1904", "1905", "1906", "1907", "1908", "1909", "191",
    "gramophone", "zonophone", "pathe", "pathé", "beka", "syrena", "extraphone", "amour", "concert record",
]
BEACON_WORDS = [
    "balalaika", "балалай", "accordion", "аккордеон", "harmonika", "гармон", "bayan", "баян", "folk", "народн",
    "dance", "танец", "пляс", "barynya", "барыня", "kalinka", "калинка", "korobeiniki", "коробейники", "troika",
    "тройка", "birch", "берёз", "берез", "orchard", "vineyard", "polka", "полька", "krakowiak", "mazurka",
    "gypsy", "цыган", "comedy", "fair", "ярмарк", "budni", "будни", "market", "village", "деревн", "meadow",
    "spinner", "wedding", "свадьб", "vodka", "beer", "пиво", "bounce", "hopak", "гопак", "kamarinskaya",
    "enthusiast", "энтузиаст", "tomorrowland", "sovietwave", "peace", "russians", "coachman", "ямщик",
    "yamstchik", "moldavian", "ukrain", "bandore", "kiev", "novelty orchestra", "russian orchestra",
    "tikhaya", "тихая", "yarmarka",
    # танцевальное и шуточное 1920-х — тоже «поселенческий» репертуар
    "tango", "танго", "foxtrot", "fox-trot", "фокстрот", "one-step", "shimmy", "charleston", "waltz-boston",
    "couplet", "куплет", "chastushk", "частушк", "humor", "comic", "шуточн", "lezginka", "лезгинк",
    "kazachok", "казачок", "merry", "cheerful", "весел", "quartet", "квартет", "harmonist", "гармонист",
]


def channels_for(entry, file_title=""):
    hay = " ".join([entry.get("title", ""), file_title, entry.get("creator", ""), entry.get("description", "")[:200],
                    entry.get("date", ""), entry.get("id", "")]).lower()
    # У каждого трека ровно одна станция, чтобы каналы звучали по-разному:
    #   безопасность — военное: ансамбли Красной армии, марши, гимны, песни войны;
    #   маяк         — народное и бытовое: пляски, баян, балалайка, романсы-шутки,
    #                  современные стилизации (pixabay/itch);
    #   пепел        — всё остальное: романсы, арии, симфоническое, дореволюционные
    #                  и неразборчивые пластинки — эхо старого мира.
    source = entry.get("source")
    if any(w in hay for w in SAFETY_WORDS):
        return [CHANNEL_SAFETY]
    if source in ("pixabay", "itch") or any(w in hay for w in BEACON_WORDS):
        return [CHANNEL_BEACON]
    return [CHANNEL_ASH]


def license_tier(entry):
    """public-domain / cc / royalty-free / unknown — для manifest и ревизии."""
    lic = (entry.get("license", "") + " " + entry.get("licenseUrl", "")).lower()
    if "public domain" in lic or "pd-" in lic or "cc0" in lic or "publicdomain" in lic:
        return "public-domain"
    if "creativecommons" in lic or lic.strip().startswith("cc"):
        return "cc"
    if entry.get("source") in ("pixabay", "itch"):
        return "royalty-free"
    return "unknown"


def year_of(entry):
    m = re.search(r"(18|19|20)\d\d", entry.get("date", "") or "")
    if m:
        return int(m.group(0))
    m = re.search(r"\b(18|19|20)\d\d\b", entry.get("description", "") or "")
    return int(m.group(0)) if m else None


def ffprobe_duration(path):
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                             capture_output=True, text=True, check=True).stdout.strip()
        return round(float(out), 1)
    except Exception:  # noqa: BLE001
        return None


def encode(src, dest, bitrate):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "22050",
           "-af", "loudnorm=I=-18:TP=-2:LRA=11", "-codec:a", "libmp3lame", "-b:a", bitrate, "-map_metadata", "-1", dest]
    subprocess.run(cmd, check=True)


def cmd_build(args):
    root = args.root
    out = args.out
    index_path = os.path.join(root, "raw", "index.json")
    with open(index_path, encoding="utf-8") as fh:
        index = json.load(fh)
    for manual in ("pixabay", "itch"):
        index[manual] = fetch_manual(root, manual)
    tracks = []
    jobs = []
    for source, entries in index.items():
        for entry in entries:
            for f in entry["files"]:
                rel = f["path"] if isinstance(f, dict) else f
                file_title = f.get("title", "") if isinstance(f, dict) else ""
                src = os.path.join(root, "raw", rel)
                if not os.path.exists(src):
                    continue
                digest = hashlib.sha1(rel.encode("utf-8")).hexdigest()[:10]
                slug = re.sub(r"[^a-z0-9]+", "-", (entry["title"] or entry["id"]).lower().encode("ascii", "ignore").decode()).strip("-")[:40]
                name = "%s-%s-%s.mp3" % (source, slug or "track", digest)
                title = entry["title"]
                if file_title and file_title.lower() not in ("", title.lower(), "title in russian", "none legible"):
                    title = file_title if title.lower() in ("title in russian", "none legible", "") else title + " · " + file_title
                if title.lower() in ("title in russian", "none legible", ""):
                    title = "Без названия (" + entry["id"] + ")"
                track = {
                    "id": os.path.splitext(name)[0],
                    "file": name,
                    "title": title,
                    "artist": entry.get("creator", ""),
                    "year": year_of(entry),
                    "source": source,
                    "sourceId": entry["id"],
                    "page": entry.get("page", ""),
                    "license": entry.get("license") or entry.get("licenseUrl") or "",
                    "tier": license_tier(entry),
                    "channels": channels_for(entry, file_title),
                }
                tracks.append(track)
                jobs.append((src, os.path.join(out, name), track))
    log("build: %d треков → %s" % (len(tracks), out))
    os.makedirs(out, exist_ok=True)

    def work(job):
        src, dest, track = job
        if not os.path.exists(dest) or args.force:
            encode(src, dest, args.bitrate)
        track["duration"] = ffprobe_duration(dest)
        track["bytes"] = os.path.getsize(dest)
        return track

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for n, track in enumerate(pool.map(work, jobs), 1):
            if n % 25 == 0 or n == len(jobs):
                log("build %d/%d" % (n, len(jobs)))
    tracks.sort(key=lambda t: (t["source"], t["title"]))
    counts = {c: sum(1 for t in tracks if c in t["channels"]) for c in (CHANNEL_BEACON, CHANNEL_ASH, CHANNEL_SAFETY)}
    tiers = {}
    for t in tracks:
        tiers[t["tier"]] = tiers.get(t["tier"], 0) + 1
    generated_at = time.strftime("%Y-%m-%dT%H:%M:%S")
    manifest = {
        "version": 1,
        "generatedAt": generated_at,
        # Общее расписание эфира: клиенты считают текущую пластинку и смещение
        # от серверных часов детерминированно (RoaRadio.BuildOrder/SlotAt),
        # так что все игроки слышат одно и то же. Пересборка манифеста меняет
        # порядок у всех одновременно.
        "scheduleEpoch": 1767225600,
        "scheduleSeed": zlib.crc32(generated_at.encode("utf-8")) & 0x7FFFFFFF,
        "channels": {CHANNEL_BEACON: 0, CHANNEL_ASH: 1, CHANNEL_SAFETY: 2},
        "counts": counts,
        "tiers": tiers,
        "tracks": tracks,
    }
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    log("manifest: %s; каналы %s; лицензии %s" % (len(tracks), counts, tiers))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    default_root = os.path.join(repo, "radio-library")
    p = sub.add_parser("fetch")
    p.add_argument("--root", default=default_root)
    p.add_argument("--sources", default="", help="commons,mrcsf,great78 (по умолчанию все)")
    p.set_defaults(func=cmd_fetch)
    p = sub.add_parser("build")
    p.add_argument("--root", default=default_root)
    p.add_argument("--out", default=os.path.join(repo, "public", "radio"))
    p.add_argument("--bitrate", default="64k")
    p.add_argument("--workers", type=int, default=max(2, (os.cpu_count() or 4) - 1))
    p.add_argument("--force", action="store_true")
    p.set_defaults(func=cmd_build)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
