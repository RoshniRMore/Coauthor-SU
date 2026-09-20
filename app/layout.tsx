import './globals.css';
import Link from 'next/link';
export const metadata={title:'Orange Coauthor',description:'Explore Syracuse research and find evidence-backed collaborators.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body><header><Link className="brand" href="/">Orange Coauthor</Link><nav aria-label="Main navigation"><Link href="/">Themes</Link><Link href="/idea">Post an idea</Link><Link href="/matches">Matches</Link><Link href="/faculty">Faculty view</Link></nav></header><main>{children}</main><footer><span>Demo coverage: 300 synthetic fallback faculty · 1,200 publications · 150 projects</span><span>Live Syracuse sources were unreachable during this build; no availability is inferred.</span></footer></body></html>}
