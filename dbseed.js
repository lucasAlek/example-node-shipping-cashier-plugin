const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('../db/sample_app.db');

db.run('CREATE TABLE credentials (name text)');

db.close();
