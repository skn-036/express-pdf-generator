export type Dimension = {
    width: number;
    height: number;
    type?: string;
};

export type FileType = {
    ext: string;
    mime: string;
};

export type PdfPart = Dimension & {
    html: string;
};
