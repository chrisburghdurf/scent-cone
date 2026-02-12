import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="icon" type="image/svg+xml" href="/mcsar-logo.svg" />
        <link rel="shortcut icon" href="/mcsar-logo.svg" />
        <link rel="apple-touch-icon" href="/mcsar-logo.svg" />
      </Head>
      <body className="antialiased">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
