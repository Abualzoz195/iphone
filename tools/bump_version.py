"""Change le numéro de version de l'app pour forcer l'iPhone à retélécharger les fichiers.

Ajoute « ?v=VERSION » au CSS, au script principal et à chaque import entre fichiers JS,
et écrit la version dans index.html (affichée dans Réglages).
À lancer avant chaque commit qui modifie l'app :  python3 tools/bump_version.py
"""
import datetime
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = datetime.datetime.now().strftime("%Y%m%d-%H%M")

index = ROOT / "index.html"
html = index.read_text(encoding="utf-8")
html = re.sub(r'(href="css/style\.css)(\?v=[\w-]+)?"', rf'\1?v={VERSION}"', html)
html = re.sub(r'(src="js/app\.js)(\?v=[\w-]+)?"', rf'\1?v={VERSION}"', html)
html = re.sub(r'(<meta name="app-version" content=")[^"]*"', rf'\g<1>{VERSION}"', html)
index.write_text(html, encoding="utf-8")

for path in (ROOT / "js").glob("*.js"):
    if path.name == "network.js":
        continue
    code = path.read_text(encoding="utf-8")
    code = re.sub(r'(from "\./[\w-]+\.js)(\?v=[\w-]+)?"', rf'\1?v={VERSION}"', code)
    path.write_text(code, encoding="utf-8")

print(f"Version {VERSION}")
