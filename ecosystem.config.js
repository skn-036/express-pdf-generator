require('dotenv').config();
const env = process.env;

let interpreter = undefined;
if (env.NODE_VERSION) {
    interpreter = `/home/ubuntu/.nvm/versions/node/${env.NODE_VERSION}/bin/node`;
}

module.exports = {
    apps: [
        {
            name: 'Express Backend',
            script: './dist/index.js',
            interpreter,
        },
    ],
};

