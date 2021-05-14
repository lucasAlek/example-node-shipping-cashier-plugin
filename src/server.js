require('dotenv').config();
const app = require('./app');

app.listen(8002, () => {
    console.log('Example app listening on port 8002!');
});
