#!/bin/bash
python3 -c "import fitz; print('PyMuPDF version:', fitz.version)" 2>&1 || echo "PyMuPDF NOT installed"
