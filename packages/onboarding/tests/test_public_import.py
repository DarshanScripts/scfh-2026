import importlib.util
from pathlib import Path
import json
import shutil

import pytest

from onboarding.contracts import Document

PROJECT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("public_import", PROJECT / "scripts/import_public_pdfs.py")
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def test_extracted_passage_offsets_cover_real_text_without_rewriting():
    text = "Facilities maintenance. " + "A documented procedure with a repeated phrase. " * 80
    document = Document(documentId="example", title="Example", format="pdf",
                        revision="a" * 64, relativePath="example.pdf")
    passages = importer.passages_for_pages(
        {"expectedPages": 1, "publishedPeriod": "2023-09"}, document, [text],
    )
    assert len(passages) > 1
    for passage in passages:
        locator = passage.locator
        assert text[locator.start:locator.end] == passage.quote
        assert locator.page == 1
    with pytest.raises(ValueError, match="Page count changed"):
        importer.passages_for_pages({"expectedPages": 2}, document, [text])


def test_public_catalog_covers_one_authority_and_audit_history():
    catalog = json.loads(importer.CATALOG.read_text())
    documents = {record["documentId"]: record for record in catalog["documents"]}
    assert len(documents) == len(catalog["documents"]) == 4
    assert sum(record["expectedPages"] for record in documents.values()) == 46
    for record in documents.values():
        assert set(record["relatedDocumentIds"]) <= documents.keys()
        assert record["url"].startswith(("https://www.cityofdenton.com/", "https://lfpubweb.cityofdenton.com/"))


def test_original_import_can_be_retried_without_changing_active_generation(tmp_path, monkeypatch):
    original = PROJECT / "src/onboarding/fixtures/maintenance-intake-guide.pdf"
    incoming = tmp_path / "incoming"
    incoming.mkdir()
    shutil.copyfile(original, incoming / original.name)
    catalog = tmp_path / "catalog.json"
    catalog.write_text(json.dumps({"documents": [{
        "documentId": "test-facilities-guide", "title": "Test facilities guide",
        "relativePath": original.name, "expectedPages": 3, "publishedPeriod": "2026-11",
    }]}))
    monkeypatch.setattr(importer, "CATALOG", catalog)
    output = tmp_path / "output"
    importer.import_corpus(output, incoming)
    active = (output / "CURRENT").read_text()
    importer.import_corpus(output, incoming)
    assert (output / "CURRENT").read_text() == active
    generation = output / active.strip()
    assert (generation / original.name).read_bytes() == original.read_bytes()
    index = json.loads((generation / "sources.json").read_text())
    assert len({p["locator"]["page"] for p in index["passages"]}) == 3
