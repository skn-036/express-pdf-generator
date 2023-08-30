import { Request, Response } from 'express';
import puppeteer, { PDFOptions, Browser } from 'puppeteer';
import axios from 'axios';
import sizeof from 'image-size';
import { fromBuffer } from 'file-type';
import pdf2img from 'pdf-img-convert';

import { Dimension, PdfPart, FileType } from './types';
import env from './env';

const pageWidth = 596;

export const generatePdf = async (req: Request, res: Response) => {
    try {
        const { header, body, footer, watermark, original_cv } = req.body;

        let bodyHtml = convertNullToEmptyString(body);

        const { browser, page } = await launchPuppeteer();

        let options: PDFOptions = {
            format: 'A4',
            margin: {
                top: 72,
                bottom: 72,
                left: 0,
                right: 0,
            },
            path: 'output.pdf',
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

        let watermarkFile: {
            dimensions: Dimension;
            type: FileType;
            content: string;
        } | null = null;

        if (Boolean(watermark)) {
            watermarkFile = await fileToBase64(
                watermark,
                'Watermark file is not valid'
            );
            if (watermarkFile?.content) {
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

        // if (original_cv) {
        //     const x = await handleOriginalCv(original_cv, bodyHtml, options);
        //     res.send(x);
        //     return;
        // }

        bodyHtml = await handleOriginalCv(
            original_cv,
            bodyHtml,
            options,
            watermarkFile
        );
        await page.setContent(bodyHtml);

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

const handleOriginalCv = async (
    cvPath: string | undefined,
    bodyHtml: string,
    options: PDFOptions,
    watermarkFile: {
        dimensions: Dimension;
        type: FileType;
        content: string;
    } | null
) => {
    if (!cvPath) {
        return `<main style="margin-left: 72px; margin-right: 72px;">${bodyHtml}</main>`;
    }
    const fileUrl = `${env.appUrl}${cvPath}`;
    const pdfPages = await pdf2img.convert(fileUrl, {
        scale: 2.2,
        base64: true,
    });

    const pdfPagesToBase64 = pdfPages.map(base64 => {
        if (typeof base64 !== 'string') return '';
        return `data:image/png;base64,${base64}`;
    });

    let html = `<main>`;

    const bodyHtmlParts = bodyHtml
        .split('{original_cv}')
        .map(
            part =>
                `${html}<div style="margin-left: 72px; margin-right: 72px">${part}</div>`
        );

    const marginTop = options?.margin?.top
        ? typeof options?.margin?.top === 'string'
            ? parseInt(options?.margin?.top)
            : options?.margin?.top
        : 72;

    const marginBottom = options?.margin?.bottom
        ? typeof options?.margin?.bottom === 'string'
            ? parseInt(options?.margin?.bottom)
            : options?.margin?.bottom
        : 72;

    const imageWidth = `${pageWidth * 1.33}px`;
    const imageHeight = `${(842 - marginTop - marginBottom) * 1.33}px`;

    const pageBreakHtml = `<div style="page-break-after: always;"></div>`;
    let pdfHtml = pageBreakHtml;

    pdfPagesToBase64.forEach(imgSrc => {
        pdfHtml = `${pdfHtml}<div style="width: ${imageWidth}; height: ${imageHeight}; position: relative;"><img src=${imgSrc} style="width: 100%; height: 100%;">${
            watermarkFile?.content
                ? `<img style="width: 280px; height: 280px; position: absolute; top: 50%; left: 50%; opacity: .25; z-index: 10; transform: translate(-50%, -50%);" src="${watermarkFile.content}">`
                : ''
        }</div>${pageBreakHtml}`;
    });

    if (bodyHtmlParts.length === 1) {
        html = `${html}${bodyHtmlParts[0]}${pdfHtml}</main>`;
    } else {
        html = `${html}${bodyHtmlParts.join(pdfHtml)}</main>`;
    }

    return html;
};
