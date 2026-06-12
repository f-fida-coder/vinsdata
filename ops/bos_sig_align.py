#!/usr/bin/env python3
"""Find every Signature line in /tmp/bos-bbox.xml + report Y coords per page.

Used to calibrate OpenSign placeholder positions for the Bill of Sale
after a layout change. pdftotext -bbox-layout gives us per-word
bounding boxes in points (Letter = 612x792).
"""
import re
import sys

with open('/tmp/bos-bbox.xml') as f:
    content = f.read()

# Split per <page> element.
pages = re.split(r'<page\s+', content)
print(f'Total pages in PDF: {len(pages) - 1}')

for i, page in enumerate(pages):
    if i == 0:
        continue
    print(f'\n--- Page {i} ---')
    # Find every "Signature" word.
    pattern = r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">Signature</word>'
    for m in re.finditer(pattern, page):
        xMin, yMin, xMax, yMax = m.groups()
        # Look backward in the page text for the preceding word to
        # disambiguate "Buyer Signature:" vs "Seller Signature:".
        idx = m.start()
        before = page[max(0, idx - 400):idx]
        prev_words = re.findall(r'<word[^>]+>([^<]+)</word>', before)
        prev_label = prev_words[-1] if prev_words else '?'
        # Look forward for trailing colon or following label.
        after = page[m.end():m.end() + 400]
        next_words = re.findall(r'<word[^>]+>([^<]+)</word>', after)
        next_label = next_words[0] if next_words else ''
        print(f'  "{prev_label} Signature" {next_label[:20]:20s}  yMin={yMin:>6s}  yMax={yMax:>6s}  xMin={xMin:>6s}')
