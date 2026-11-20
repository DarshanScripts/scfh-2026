# Original municipal facilities documents

The source catalog selects four original City of Denton PDFs totaling 46 pages, all published by the municipality. It connects the 2020 facilities audit to its February 2022 and September 2023 follow-ups and retains the older work-order procedure as a dated historical reference.

The 17-page June 2020 audit has been downloaded from the municipality’s Laserfiche archive and is included under originals. It is indexed for Qdrant retrieval. The other three DocumentCenter URLs currently return HTTP 403. Those files remain catalog references until their originals are available.

From packages/onboarding, download and index the originals.

    uv run --locked --no-env-file python scripts/import_public_pdfs.py

Alternatively, download each PDF from the catalog with the listed relativePath filename, then import those files.

    uv run --locked --no-env-file python scripts/import_public_pdfs.py --from-directory /path/to/originals

The importer validates PDF signatures, expected page counts, and extracted text. It stores original bytes with SHA-256 revisions and calculates page-based passage ranges from PDF.js. It writes a complete generation and a CURRENT pointer after all files validate. A changed PDF page count requires review.

Treat dates and document purposes explicitly when integrating retrieval. The old user-interface instructions provide historical procedure evidence. Audit findings describe the auditor's observations during the review period. Follow-up status updates do not establish every current operational instruction. The source documents belong to Denton and are unrelated to the fictional department's queue or interview accounts.

To import the original that is already available and create a 768-dimensional collection, run these commands.

    uv run --locked --no-env-file python scripts/import_public_pdfs.py --from-directory public-corpus/originals --document-id denton-facilities-audit-2020
    uv run --locked --no-env-file python -m onboarding.rag index
    uv run --locked --no-env-file python -m onboarding.server --knowledge qdrant
