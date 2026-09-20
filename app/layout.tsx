import './globals.css';
import Link from 'next/link';
import corpus from '../data/corpus.json';
export const metadata={title:'Orange Coauthor',description:'Explore Syracuse research and find evidence-backed collaborators.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><header><Link className="brand" href="/">Orange Coauthor</Link><nav aria-label="Main navigation"><Link href="/">Themes</Link><Link href="/idea">Post an idea</Link><Link href="/matches">Matches</Link><Link href="/faculty">Faculty view</Link></nav></header><main>{children}</main><footer><span>Coverage: {corpus.people.length.toLocaleString()} plausible Syracuse researchers · {corpus.publications.length.toLocaleString()} publications</span><span>Publication activity is evidence; availability is never inferred.</span></footer></body></html>}
