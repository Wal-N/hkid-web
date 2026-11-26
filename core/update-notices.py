"""Collect the license files for the pinned browser build and its Rust runtime."""

import json
import re
import subprocess
from collections import defaultdict
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


CORE = Path(__file__).resolve().parent
PUBLIC = CORE.parent / "public" / "core"
TARGET = "wasm32-unknown-unknown"


def run(*args):
    return subprocess.check_output(args, cwd=CORE, encoding="utf-8").strip()


def target_packages():
    tree = run("cargo", "tree", "--locked", "--target", TARGET, "--edges",
               "normal,no-proc-macro", "--prefix", "none", "--format", "{p}")
    active = {tuple(line.split()[:2]) for line in tree.splitlines()}
    metadata = json.loads(run("cargo", "metadata", "--locked", "--filter-platform",
                              TARGET, "--format-version", "1"))
    return sorted((pkg for pkg in metadata["packages"]
                   if pkg["id"] != metadata["resolve"]["root"]
                   and (pkg["name"], "v" + pkg["version"]) in active),
                  key=lambda pkg: (pkg["name"], pkg["version"]))


def crate_notices(packages):
    inventory = []
    texts = defaultdict(list)
    for pkg in packages:
        label = f"{pkg['name']} {pkg['version']}"
        inventory.append(f"{label}    {pkg['license']}")
        root = Path(pkg["manifest_path"]).parent
        notices = sorted(path for path in root.iterdir() if path.is_file()
                         and re.match(r"(?:COPYING|COPYRIGHT|LICEN[CS]E|NOTICE|UNLICENSE)\b",
                                      path.name, re.IGNORECASE))
        if not notices:
            raise ValueError(f"Review the upstream notices for {label}")
        for path in notices:
            content = path.read_text(encoding="utf-8").strip()
            texts[content].append(f"{label} / {path.name}")

    sections = [
        "HKID Web — browser distribution",
        (CORE.parent / "LICENSE").read_text(encoding="utf-8").strip(),
        "Rust crates used by the browser target\n\n" + "\n".join(inventory),
        """Additional attributions

HKID Utilities uses Unicode Unihan telegraph mappings for its commercial codes.
The unicode-general-category, unicode-ident and unicode-script crates use
Unicode Character Database tables. Copyright © 1991-2026 Unicode, Inc.
The Unicode License V3 terms appear below.

Chrono includes portions copyright (c) 2015, John Nagle, and portions
copyright 2012-2014 The Rust Project Developers. num-traits includes portions
copyright 2013-2014 The Rust Project Developers. The tables in unicode-script
are copyright 2012-2018 The Rust Project Developers. The lexical module in
serde_json includes code copyright Alexander Huszagh.

The GitHub mark links to the project's repository. GitHub and the Invertocat
logo are trademarks of GitHub, Inc.

The accompanying RUST-STDLIB-LICENSES.zip contains the Rust standard library
copyright inventory and license texts supplied by the release toolchain.""",
    ]
    for content, files in texts.items():
        sections.append("\n".join(files) + "\n\n" + content)
    return "\n\n".join(sections) + "\n"


def stdlib_archive():
    docs = Path(run("rustc", "--print", "sysroot")) / "share" / "doc" / "rust"
    files = [docs / "COPYRIGHT-library.html", *sorted((docs / "licenses").glob("*.txt"))]
    if len(files) == 1:
        raise ValueError(f"Missing Rust license texts in {docs / 'licenses'}")
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        for path in files:
            # A fixed timestamp and permissions make output independent of installation time.
            entry = ZipInfo(path.relative_to(docs).as_posix())
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, path.read_bytes(), compress_type=ZIP_DEFLATED)
    return output.getvalue()


if __name__ == "__main__":
    packages = target_packages()
    notices = crate_notices(packages)
    archive = stdlib_archive()
    hkid = next(pkg for pkg in packages if pkg["name"] == "hkid-utils")
    hkid_license = Path(hkid["manifest_path"]).with_name("LICENSE").read_bytes()
    (PUBLIC / "THIRD-PARTY-NOTICES.txt").write_bytes(notices.encode("utf-8"))
    (PUBLIC / "RUST-STDLIB-LICENSES.zip").write_bytes(archive)
    (PUBLIC / "HKID-UTILS-LICENSE.txt").write_bytes(hkid_license)
    print(f"Collected notices for {len(packages)} target crates and {run('rustc', '--version')}.")
