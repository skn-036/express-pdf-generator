import express, { Express, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { urlencoded, json } from 'body-parser';
import cors, { CorsOptions } from 'cors';
import { generatePdf } from './controller';

const app: Express = express();

app.use(helmet());

const corsOptions: CorsOptions = {
    origin: (_, callback) => {
        callback(null, true);
    },
    optionsSuccessStatus: 200,
};

app.use(urlencoded({ extended: false }));
app.use(json({ limit: '50mb' }));

app.use((_, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', 'true');
    next();
});

app.use(cors(corsOptions));

app.post('/generate-pdf', generatePdf);

app.listen(5000, () => {
    console.log('app is listening on port 5000');
});
