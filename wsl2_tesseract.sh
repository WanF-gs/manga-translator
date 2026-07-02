#!/bin/bash
echo "@Wanf123789" | sudo -S apt-get update -qq 2>&1 | tail -1
echo "@Wanf123789" | sudo -S apt-get install -y tesseract-ocr tesseract-ocr-jpn tesseract-ocr-chi-sim 2>&1 | tail -5
echo "Tesseract: $(tesseract --version 2>&1 | head -1)"
