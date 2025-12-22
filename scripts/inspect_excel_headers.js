
import readXlsxFile from 'read-excel-file/node';
import path from 'path';

const filePath = path.join(process.cwd(), 'August Master (2).xlsx');

console.log(`Reading file: ${filePath}`);

readXlsxFile(filePath).then((rows) => {
    console.log('File read successfully.');
    // Print first 5 rows to identify headers
    for (let i = 0; i < 5; i++) {
        if (rows[i]) {
            console.log(`Row ${i}:`, rows[i]);
        }
    }
}).catch((err) => {
    console.error('Error reading file:', err);
});
