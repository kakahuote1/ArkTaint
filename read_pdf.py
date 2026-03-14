import sys

try:
    import fitz # PyMuPDF
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pymupdf"])
    import fitz

def main():
    pdf_path = r"D:\[download]\3793863.pdf"
    doc = fitz.open(pdf_path)
    text = ""
    for page in doc:
        text += page.get_text() + "\n"
    
    with open(r"d:\cursor\workplace\ArkTaint\hapflow_paper.txt", "w", encoding="utf-8") as f:
        f.write(text)

if __name__ == "__main__":
    main()
