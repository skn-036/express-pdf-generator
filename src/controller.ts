import { Request, Response } from 'express';
import puppeteer, {
    PDFOptions,
    Browser,
    PuppeteerLaunchOptions,
} from 'puppeteer';
import axios from 'axios';
import sizeof from 'image-size';
import { fromBuffer } from 'file-type';
import pdf2img from 'pdf-img-convert';

import { Dimension, PdfPart, FileType } from './types';
import env from './env';

const pageWidth = 596;

/**
 * Generate PDF
 */
export const generatePdf = async (req: Request, res: Response) => {
    try {
        const { header, body, footer, watermark, original_cv } = req.body;

        let bodyHtml = convertNullToEmptyString(body);

        const { browser, page } = await launchPuppeteer();

        // Default: no browser header/footer (prevents about:blank + 1/4)
        let options: PDFOptions = {
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: false,
            margin: { top: 72, bottom: 72, left: 0, right: 0 },
        };

        // Prepare header/footer html if provided
        let headerHtml = '';
        if (header) {
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
                headerTemplate: headerPart.html, // valid template to suppress defaults
                footerTemplate: `<div style="font-size:0;width:100%">&nbsp;</div>`,
                margin: {
                    ...options.margin,
                    top: headerPart.height + 36,
                },
            };
        }

        if (footer) {
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
                // Ensure both templates exist to avoid Chromium default footer
                headerTemplate:
                    headerHtml ||
                    `<div style="font-size:0;width:100%">&nbsp;</div>`,
                footerTemplate: footerPart.html,
                margin: {
                    ...options.margin,
                    bottom: footerPart.height + 36,
                },
            };
        }

        // Watermark is injected into page content, not via header/footer.
        let watermarkFile: {
            dimensions: Dimension;
            type: FileType;
            content: string;
        } | null = null;

        if (watermark) {
            watermarkFile = await fileToBase64(
                watermark,
                'Watermark file is not valid'
            );
        }

        // Build final HTML (fixes: no leading/trailing page-breaks, clean structure)
        bodyHtml = await handleOriginalCv(original_cv, bodyHtml, options);

        // Inject a fixed watermark overlay across all pages (if provided)
        if (watermarkFile?.content) {
            bodyHtml = injectWatermark(bodyHtml, watermarkFile.content);
        }

        await page.setContent(bodyHtml, { waitUntil: 'networkidle0' });

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

/**
 * Read a file (local or https) into data URL + image dimensions/type
 */
const fileToBase64 = async (
    url: string,
    errorMessage: string | null = null
) => {
    try {
        const fileUrl = url.startsWith('https') ? url : `${env.appUrl}${url}`;
        const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
        });
        const buffer = Buffer.from(response.data, 'binary');

        const dimensions = sizeof(buffer) as Dimension;

        const type = (await fromBuffer(buffer)) as FileType | undefined;
        if (!type || !type.mime.includes('image/')) {
            throw new Error('File is not an image');
        }

        const content = buffer.toString('base64');
        return {
            dimensions,
            type,
            content: `data:${type.mime};base64,${content}`,
        };
    } catch {
        throw new Error(errorMessage ? errorMessage : 'Error reading in file');
    }
};

/**
 * Build header/footer part HTML sized to page width
 */
const resolvePart = (
    img: string,
    tag: 'header' | 'footer',
    dimension: Dimension
): PdfPart => {
    if (!dimension?.width) {
        return {
            html: `<${tag}><img style="width:${pageWidth}px;height:80px" src="${img}"></${tag}>`,
            width: pageWidth,
            height: 80,
        };
    }

    const { width, height } = dimension;
    if (width < 380) {
        return {
            html: `<${tag}><img style="width:${width}px;height:80px" src="${img}"></${tag}>`,
            width,
            height: 80,
        };
    }

    const compressionRatio = width / pageWidth;
    const contentHeight = Math.ceil(height / compressionRatio);
    const marginMapper = { header: 'top', footer: 'bottom' } as const;

    return {
        html: `<${tag} style="margin-${marginMapper[tag]}:-16px"><img style="width:${pageWidth}px;height:${contentHeight}px" src="${img}"></${tag}>`,
        width: pageWidth,
        height: contentHeight,
    };
};

const convertNullToEmptyString = (content: unknown): string => {
    if (!content || typeof content !== 'string') return '';
    return content;
};

/**
 * Launch Puppeteer
 */
const launchPuppeteer = async () => {
    let launchOptions: PuppeteerLaunchOptions = { headless: true };
    if (env.environment === 'production') {
        launchOptions = {
            ...launchOptions,
            executablePath: '/usr/bin/chromium-browser',
            args: ['--no-sandbox'],
        };
    }

    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    return { browser, page };
};

const closePuppeteer = async (browser: Browser) => {
    await browser.close();
};

/**
 * Build the final HTML, placing converted original_cv pages where {original_cv} appears.
 * Fixes: no leading/trailing blank page (page-breaks only between pages).
 */
const handleOriginalCv = async (
    cvPath: string | undefined,
    bodyHtml: string,
    options: PDFOptions
): Promise<string> => {
    // No original CV: simple wrapper with margins
    if (!cvPath) {
        return `<main style="margin-left:72px;margin-right:72px;">${bodyHtml}</main>`;
    }

    const fileUrl = cvPath.startsWith('https')
        ? cvPath
        : `${env.appUrl}${cvPath}`;
    const pdfPages = await pdf2img.convert(fileUrl, {
        scale: 2.2,
        base64: true,
    });

    const pdfPagesToBase64 = pdfPages.map((base64) =>
        typeof base64 === 'string' ? `data:image/png;base64,${base64}` : ''
    );

    const marginTop =
        options?.margin?.top != null
            ? typeof options.margin!.top === 'string'
                ? parseInt(options.margin!.top)
                : options.margin!.top
            : 72;

    const marginBottom =
        options?.margin?.bottom != null
            ? typeof options.margin!.bottom === 'string'
                ? parseInt(options.margin!.bottom)
                : options.margin!.bottom
            : 72;

    // Chromium's A4 height ~ 842pt at 72 DPI
    const imageWidth = `${pageWidth * 1.33}px`;
    const imageHeight = `${(842 - marginTop - marginBottom) * 1.33}px`;

    // Build image pages with page-breaks only BETWEEN pages (no leading/trailing)
    const pageBreakHtml = `<div style="page-break-after:always;"></div>`;
    const pdfHtml = pdfPagesToBase64
        .map(
            (imgSrc) => `
      <div style="width:${imageWidth};height:${imageHeight};position:relative;">
        <img src="${imgSrc}" style="width:100%;height:100%;">
      </div>`
        )
        .join(pageBreakHtml);

    // Split body by placeholder and join with pdfHtml in between
    const parts = bodyHtml
        .split('{original_cv}')
        .map(
            (part) =>
                `<div style="margin-left:72px;margin-right:72px">${part}</div>`
        );

    let html = `<main>`;
    html += parts.length === 1 ? `${parts[0]}${pdfHtml}` : parts.join(pdfHtml);
    html += `</main>`;
    return html;
};

/**
 * Inject a fixed watermark overlay across all pages without enabling header/footer.
 */
const injectWatermark = (html: string, dataUrl: string): string => {
    const wm = `
    <div style="
      position:fixed;
      top:50%;
      left:50%;
      transform:translate(-50%,-50%);
      width:280px;
      height:280px;
      opacity:.25;
      z-index:10;
      pointer-events:none;">
      <img src="${dataUrl}" style="width:100%;height:100%;" />
    </div>
  `;
    // Place before content so it renders on each printed page
    return `${wm}${html}`;
};
