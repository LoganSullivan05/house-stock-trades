import PyPDF2
import sys
import os

#TODO: Look into pdfplumber
print(sys.argv)
file_name = sys.argv[1]
out_name = file_name.replace(".pdf", ".txt")
if len(sys.argv) >= 3: out_name = sys.argv[2]

file = open(file_name, "rb")
reader = PyPDF2.PdfReader(file)
text = "\n".join([page.extract_text() for page in reader.pages if page.extract_text()])

file = open(out_name, "w", encoding="utf-8", errors="ignore")
file.write(text)


# Convert all in directory

# pdf_dir = "data/house_pdfs"
# txt_dir = "data/house_txts"

# for filename in os.listdir(pdf_dir):

#     if not filename.lower().endswith(".pdf"): continue

#     pdf_path = os.path.join(pdf_dir, filename)
#     txt_filename = filename.replace(".pdf", ".txt")
#     txt_path = os.path.join(txt_dir, txt_filename)

#     if os.path.exists(txt_path): continue

#     with open(pdf_path, "rb") as f:
#         reader = PyPDF2.PdfReader(f)
#         text = "\n".join([page.extract_text() for page in reader.pages if page.extract_text()])
    
#     with open(txt_path, "w", encoding="utf-8", errors="ignore") as out_file:
#         out_file.write(text)

