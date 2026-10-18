"""Build reports/paper.pdf from reports/paper.md (figures are embedded from reports/figures/).

Global context: the last stage of `npm run experiments`. Uses markdown-pdf (markdown-it-py + PyMuPDF,
https://github.com/vb64/markdown-pdf): `Section(text, root=...)` resolves image paths relative to `root`.
"""

from markdown_pdf import MarkdownPdf, Section  # Markdown -> PDF.

from common import ROOT, log  # Paths + logger.

CSS = """
body { font-family: serif; font-size: 10pt; line-height: 1.35; }
h1 { font-size: 15pt; } h2 { font-size: 12pt; margin-top: 10pt; }
table { border-collapse: collapse; font-size: 8.5pt; } th, td { border: 0.5pt solid #888; padding: 2pt 4pt; }
img { width: 100%; }
"""  # Compact academic style; tables bordered, figures full width.


def main() -> None:
    """Convert the paper markdown into a PDF with metadata."""
    reports = ROOT / "reports"  # Paper folder (image paths are relative to it).
    text = (reports / "paper.md").read_text(encoding="utf8")  # Paper source.
    pdf = MarkdownPdf(toc_level=2, mode="gfm-like", optimize=True)  # gfm-like enables tables.
    pdf.add_section(Section(text, root=str(reports), paper_size="A4"), user_css=CSS)  # One section, A4.
    pdf.meta["title"] = "Counter-Strike: Source bunnyhopping in a browser voxel game"  # PDF metadata.
    pdf.meta["author"] = "Libor Burian"
    out = reports / "paper.pdf"  # Output path.
    pdf.save(str(out))  # Write the PDF.
    log(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
