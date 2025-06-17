import PyPDF2
import sys
import os

file_name = sys.argv[1]
out_name = file_name.replace(".pdf", ".txt")
if len(sys.argv) >= 3: out_name = sys.argv[2]

file = open(file_name, "rb")
reader = PyPDF2.PdfReader(file)
text = "\n".join([page.extract_text() for page in reader.pages if page.extract_text()])

file = open(out_name, "w", encoding="utf-8", errors="ignore")
file.write(text)
