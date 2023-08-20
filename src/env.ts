import dotenv from 'dotenv';
dotenv.config();

type Env = {
    appUrl: string;
};

const envVars = process.env;

const env: Env = {
    appUrl: envVars?.APP_URL ? envVars.APP_URL : '',
};

export default env;
