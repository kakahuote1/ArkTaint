const fs = require('fs');
const pdf = require('pdf-parse');

let dataBuffer = fs.readFileSync('D:\\\\[download]\\\\3793863.pdf');

(pdf.default || pdf)(dataBuffer).then(function (data) {
    fs.writeFileSync('d:\\\\cursor\\\\workplace\\\\ArkTaint\\\\hapflow_paper.txt', data.text);
}).catch(console.error);
