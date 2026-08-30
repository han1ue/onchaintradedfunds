import { generateStaticParamsFor, importPage } from "nextra/pages";
import { useMDXComponents as getMDXComponents } from "../../mdx-components";

type PageProps = {
  params: Promise<{ mdxPath?: string[] }>;
};

export const generateStaticParams = generateStaticParamsFor("mdxPath");

export async function generateMetadata({ params }: PageProps) {
  const { mdxPath = [] } = await params;
  const { metadata } = await importPage(mdxPath);
  const pathname = `/${mdxPath.join("/")}`;

  return {
    ...metadata,
    alternates: { canonical: pathname },
  };
}

const Wrapper = getMDXComponents().wrapper;

export default async function Page(props: PageProps) {
  if (!Wrapper) {
    throw new Error("Nextra theme wrapper is unavailable.");
  }

  const params = await props.params;
  const { mdxPath = [] } = params;
  const {
    default: MDXContent,
    toc,
    metadata,
    sourceCode,
  } = await importPage(mdxPath);

  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      <MDXContent {...props} params={params} />
    </Wrapper>
  );
}
