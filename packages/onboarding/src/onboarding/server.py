"""Loopback-only browser harness. The Windows host can import FixtureKnowledge directly."""

import argparse
from collections import OrderedDict
from functools import partial
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from mimetypes import guess_type
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from pydantic import ValidationError

from .contracts import Answer, CitationRequest, CitationUnavailable, Query, Request, StrictModel, Walkthrough
from .knowledge import FixtureKnowledge
from .rag import QdrantKnowledge, RagError

PDFJS_VERSION = "5.6.205"
PDFJS_FILES = {
    "/pdfjs/pdf.mjs": "build/pdf.mjs",
    "/pdfjs/pdf.worker.mjs": "build/pdf.worker.mjs",
    "/pdfjs/pdf_viewer.css": "web/pdf_viewer.css",
}
WEB = Path(__file__).with_name("web")
STYLES = {"/": WEB / "index.html", "/style.css": WEB / "style.css"}


class Question(StrictModel):
    query: Query


class Harness:
    def __init__(self, pdfjs: Path, bundle: Path, excalidraw_fonts: Path,
                 knowledge: FixtureKnowledge | QdrantKnowledge | None = None):
        self.knowledge = knowledge or FixtureKnowledge()
        self.assets = {
            **STYLES,
            "/harness.js": bundle,
            "/answers.js": bundle.with_name("answers.js"),
            **{url: pdfjs / name for url, name in PDFJS_FILES.items()},
            **{
                "/excalidraw-assets/" + font.relative_to(excalidraw_fonts.parent).as_posix(): font
                for font in excalidraw_fonts.rglob("*.woff2")
            },
        }
        self.is_rag = isinstance(self.knowledge, QdrantKnowledge)
        self.results: OrderedDict[UUID, Answer | Walkthrough] = OrderedDict()
        self.lock = Lock()

    def remember(self, result: Answer | Walkthrough) -> None:
        with self.lock:
            self.results[result.requestId] = result
            if len(self.results) > 64:
                self.results.popitem(last=False)

    def citation(self, request: CitationRequest):
        with self.lock:
            result = self.results.get(request.requestId)
        if result is None:
            return CitationUnavailable()
        return self.knowledge.open_citation(request, result)


class Handler(BaseHTTPRequestHandler):
    def __init__(self, harness: Harness, *args, **kwargs):
        self.harness = harness
        super().__init__(*args, **kwargs)

    def send_payload(self, status: int, content: bytes, mime: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        try:
            self.end_headers()
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def send_result(self, result: StrictModel) -> None:
        self.send_payload(200, result.model_dump_json().encode("utf-8"), "application/json")

    def do_GET(self) -> None:
        url = urlsplit(self.path)
        if url.path == "/health":
            self.send_payload(200, b"{}", "application/json")
            return
        if url.path == "/schema/answer":
            import json
            self.send_payload(200, json.dumps(Answer.model_json_schema()).encode("utf-8"), "application/json")
            return
        path = self.harness.assets.get(url.path)
        if url.path.startswith("/sources/"):
            try:
                source = self.harness.knowledge.document_path(url.path.removeprefix("/sources/"))
                content = source.read_bytes()
                if parse_qs(url.query).get("revision") != [sha256(content).hexdigest()]:
                    self.send_error(409, "Source revision changed")
                    return
                self.send_payload(200, content, guess_type(source.name)[0] or "application/octet-stream")
            except (KeyError, ValueError, OSError):
                self.send_error(404, "Source unavailable")
            return
        if path is None or not path.is_file():
            self.send_error(404)
            return
        if url.path == "/" and self.harness.is_rag:
            html = path.read_text(encoding="utf-8")
            html = html.replace("Facilities Service Desk", "Denton facilities document search")
            html = html.replace("Onboarding demo with sample documents", "Original municipal audit · June 2020 · Qdrant retrieval")
            replacements = [
                ("Where’s the guide for logging a maintenance request, and what do I need before I open a ticket?",
                 "According to the June 2020 audit, how are maintenance requests assigned to technicians?"),
                ("A maintenance ticket still has no owner. When should I follow up, and who do I tell?",
                 "What weaknesses did the June 2020 audit find in facility access management?"),
                ("I’m taking over the queue. Which open item is due first, and who owns it?",
                 "What documentation should technicians record when they finish a work order?"),
                ("Intake checklist", "Work-order assignment"),
                ("Unassigned ticket", "Access management"),
                ("Next deadline", "Completion records"),
            ]
            for before, after in replacements:
                html = html.replace(before, after)
            self.send_payload(200, html.encode("utf-8"), "text/html; charset=utf-8")
            return
        mime = "text/javascript" if path.suffix in {".js", ".mjs"} else guess_type(path.name)[0]
        self.send_payload(200, path.read_bytes(), mime or "application/octet-stream")

    def do_POST(self) -> None:
        if self.headers.get_content_type() != "application/json":
            self.send_error(415)
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 4096:
                self.send_error(400, "Invalid request size")
                return
            payload = self.rfile.read(size)
            if self.path == "/api/citation":
                self.send_result(self.harness.citation(CitationRequest.model_validate_json(payload)))
                return
            if self.path not in {"/api/question", "/api/walkthrough"}:
                self.send_error(404)
                return
            try:
                request = Request.model_validate_json(payload)
                query = request.query
                ids = {"request_id": request.requestId, "turn_id": request.turnId}
            except ValidationError:
                query = Question.model_validate_json(payload).query
                ids = {}
            knowledge = self.harness.knowledge
            result = (
                knowledge.answer_onboarding_question(query, **ids) if self.path == "/api/question"
                else knowledge.get_onboarding_walkthrough(query, **ids)
            )
            if isinstance(result, (Answer, Walkthrough)):
                self.harness.remember(result)
            self.send_result(result)
        except (ValidationError, ValueError):
            self.send_error(400, "Invalid request")
        except RagError:
            self.send_error(503, "The knowledge service could not complete this request")


def main() -> None:
    import json

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--knowledge", choices=["fixtures", "qdrant"], default="fixtures")
    parser.add_argument("--pdfjs-dir", type=Path, default=Path("node_modules/pdfjs-dist"))
    parser.add_argument("--bundle", type=Path, default=Path("dist/harness.js"))
    parser.add_argument("--excalidraw-fonts", type=Path,
                        default=Path("node_modules/@excalidraw/excalidraw/dist/prod/fonts"))
    args = parser.parse_args()
    try:
        package = json.loads((args.pdfjs_dir / "package.json").read_text(encoding="utf-8"))
    except OSError:
        parser.error("Install PDF.js or pass --pdfjs-dir pointing to its package directory")
    if package.get("version") != PDFJS_VERSION:
        parser.error(f"The fixture locators use pdfjs-dist {PDFJS_VERSION}")
    if not args.bundle.is_file():
        parser.error("Build the harness bundle before starting the server")
    try:
        knowledge = QdrantKnowledge() if args.knowledge == "qdrant" else FixtureKnowledge()
    except RagError as error:
        parser.error(str(error))
    harness = Harness(args.pdfjs_dir, args.bundle, args.excalidraw_fonts, knowledge)
    with ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, harness)) as server:
        print(f"Facilities onboarding harness at http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            if isinstance(knowledge, QdrantKnowledge):
                knowledge.close()


if __name__ == "__main__":
    main()
