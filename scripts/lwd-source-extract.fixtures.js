/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

// Minimal, valid PDF generators for the extraction tests + verification artefacts (issue #131). We
// build real PDFs (correct object offsets + xref) rather than binary blobs so pdf-parse/pdfjs parses
// them exactly as it would a user's file:
//  - makeTextPdf: a one-page PDF with a selectable text run -> extractPdf must read it.
//  - makeImageOnlyPdf: a one-page PDF that draws only vector graphics, ZERO selectable text -> the
//    same signature as a scanned/image-only page, so extractPdf must name it unreadable.

// Assemble a PDF from a list of object bodies, computing byte offsets for a correct xref table.
function assemblePdf(objects, rootObjNum) {
	const header = '%PDF-1.4\n';
	let body = '';
	const offsets = [];
	let pos = Buffer.byteLength(header, 'latin1');
	for (let i = 0; i < objects.length; i++) {
		offsets[i] = pos;
		const chunk = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
		body += chunk;
		pos += Buffer.byteLength(chunk, 'latin1');
	}
	const xrefStart = pos;
	let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (let i = 0; i < objects.length; i++) {
		xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
	}
	const trailer = `trailer\n<< /Size ${objects.length + 1} /Root ${rootObjNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
	return Buffer.from(header + body + xref + trailer, 'latin1');
}

// A one-page PDF containing a single line of selectable text.
function makeTextPdf(text) {
	const safe = String(text).replace(/([()\\])/g, '\\$1');
	const content = `BT /F1 14 Tf 40 120 Td (${safe}) Tj ET`;
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
		`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
	];
	return assemblePdf(objects, 1);
}

// A one-page PDF that draws only a filled rectangle - no text operators at all, so pdfjs extracts no
// selectable text. Stands in for a scanned/image-only page.
function makeImageOnlyPdf() {
	const content = '20 20 260 160 re f';
	const objects = [
		'<< /Type /Catalog /Pages 2 0 R >>',
		'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
		'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << >> >>',
		`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
	];
	return assemblePdf(objects, 1);
}

module.exports = { makeTextPdf, makeImageOnlyPdf };
