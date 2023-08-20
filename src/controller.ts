import { Request, Response } from 'express';
import puppeteer, { PDFOptions, Browser } from 'puppeteer';
import axios from 'axios';
import sizeof from 'image-size';
import { fromBuffer } from 'file-type';

import { Dimension, PdfPart, FileType } from './types';
import env from './env';

const pageWidth = 596;

export const generatePdf = async (req: Request, res: Response) => {
    try {
        const { header, body, footer, watermark } = req.body;

        let bodyHtml = convertNullToEmptyString(body);

        const { browser, page } = await launchPuppeteer();
        await page.setContent(bodyHtml);

        let options: PDFOptions = {
            format: 'A4',
            margin: {
                top: 72,
                bottom: 72,
                left: 72,
                right: 72,
            },
        };

        let headerHtml = '';
        if (Boolean(header)) {
            const headerFile = await fileToBase64(
                header,
                'Header file is not valid'
            );

            const headerPart = resolvePart(
                headerFile.content,
                'header',
                headerFile.dimensions as Dimension
            );

            headerHtml = headerPart.html;
            options = {
                ...options,
                displayHeaderFooter: true,
                headerTemplate: headerHtml,
                margin: {
                    ...options.margin,
                    top: headerPart.height + 36,
                },
            };
        }

        if (Boolean(watermark)) {
            const watermarkFile = await fileToBase64(
                watermark,
                'Watermark file is not valid'
            );
            if (watermarkFile.content) {
                const watermarkHtml = `<img style="width: 280px; height: 280px; position: fixed; top: 281px; left: 158px; opacity: .25" src="${watermarkFile.content}">`;

                options = {
                    ...options,
                    displayHeaderFooter: true,
                    headerTemplate: `${headerHtml}${watermarkHtml}`,
                    footerTemplate: ' ',
                };
            }
        }

        if (Boolean(footer)) {
            const footerFile = await fileToBase64(
                footer,
                'Footer file is not valid'
            );

            const footerPart = resolvePart(
                footerFile.content,
                'footer',
                footerFile.dimensions as Dimension
            );

            options = {
                ...options,
                displayHeaderFooter: true,
                footerTemplate: footerPart.html,
                margin: {
                    ...options.margin,
                    bottom: footerPart.height + 36,
                },
            };
        }

        const pdf = await page.pdf(options);
        await closePuppeteer(browser);

        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="document.pdf"',
            'Content-Length': pdf.length,
        }).send(pdf);
    } catch (error) {
        res.status(403).send({
            message: error instanceof Error ? error.message : 'Server error',
        });
    }
};

const fileToBase64 = async (
    url: string,
    errorMessage: string | null = null
) => {
    try {
        const fileUrl = `${env.appUrl}${url}`;

        const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
        });
        const buffer = Buffer.from(response.data, 'binary');

        const dimensions = sizeof(buffer) as Dimension;

        const type = (await fromBuffer(buffer)) as FileType | undefined;
        if (!type || !type.mime.includes('image/'))
            throw new Error('File is not an image');

        const content = buffer.toString('base64');

        return {
            dimensions,
            type,
            content: `data:${type.mime};base64,${content}`,
        };
    } catch (error) {
        throw new Error(errorMessage ? errorMessage : 'Error reading in file');
    }
};

const resolvePart = (
    img: string,
    tag: 'header' | 'footer',
    dimension: Dimension
): PdfPart => {
    if (!dimension?.width) {
        return {
            html: `<${tag}><img style="width: ${pageWidth}px; height: 80px" src="${img}"></${tag}>`,
            width: pageWidth,
            height: 80,
        };
    }
    const { width, height } = dimension;
    if (width < 380) {
        return {
            html: `<${tag}><img style="width: ${width}px; height: 80px" src="${img}"></${tag}>`,
            width,
            height: 80,
        };
    }

    const compressionRatio = width / pageWidth;
    const contentHeight = Math.ceil(height / compressionRatio);

    const marginMapper = {
        header: 'top',
        footer: 'bottom',
    };

    return {
        html: `<${tag} style="margin-${marginMapper[tag]}: -16px;"> <img style="width: ${pageWidth}px; height: ${contentHeight}px" src="${img}"></${tag}>`,
        width: pageWidth,
        height: contentHeight,
    };
};

const convertNullToEmptyString = (content: any): string => {
    if (!content || typeof content !== 'string') return '';
    return content;
};

const launchPuppeteer = async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    return { browser, page };
};

const closePuppeteer = async (browser: Browser) => {
    await browser.close();
};
