import dotenv from 'dotenv';
dotenv.config();

type Env = {
    appUrl: string;
    port: string | number;
};

const envVars = process.env;

const env: Env = {
    appUrl: envVars?.APP_URL ? envVars.APP_URL : '',
    port: envVars?.PORT ? envVars?.PORT : 5000,
};

export default env;
