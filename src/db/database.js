const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');


const DB_PATH = path.resolve(__dirname, '../../data/queuectl.sqlite3');


function init() {
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
const migration = fs.readFileSync(path.resolve(__dirname, './migrations.sql'), 'utf8');
db.exec(migration);
return db;
}


module.exports = { init, DB_PATH };