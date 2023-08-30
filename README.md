# express-pdf-generator

Using typescript and puppeteer, a pdf file generator with options to add header footer and watermark in every page.

# env variables

APP_URL=Base url to the file paths

# request url

http://127.0.0.1:5000/generate-pdf

# request method

POST

# request paramaters

absoute path to the header image file with respect to base url. for example, for a url https://picsum.photos/800/300, APP_URL in env file should be 'https://picsum.photos' and the header will be '/800/300'

```javascript
type RequestParams = {
    header?: string, // absoute path to the header image.
    body?: string, // html content of the pdf body
    footer?: string, // absoute path to the footer image.
    watermark?: string, // absoute path to the watermark image.
    original_cv?: string, // absoute path to the watermark image.
};
```
