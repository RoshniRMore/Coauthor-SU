'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import type {QueryMatches} from '../../lib/data';
export default function Matches(){
 const[q,setQ]=useState<string|null>(null),[opted,setOpted]=useState(false);
 useEffect(()=>{setQ(localStorage.getItem('idea')||'climate health data');setOpted(localStorage.getItem('optedIn')==='true')},[]);
 const [embedding,setEmbedding]=useState<(QueryMatches & {vector:number[],fallback:boolean,warning?:string})|null>(null);
 const [error,setError]=useState('');
 useEffect(()=>{if(!q)return;const controller=new AbortController();setEmbedding(null);setError('');fetch('/api/embed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:q}),signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error);setEmbedding(data)}).catch(error=>{if(error.name!=='AbortError')setError(error.message)});return()=>controller.abort()},[q]);
 const fm=(embedding?.faculty || []).map((m,i)=>({...m,score:Math.min(.99,m.score+(opted&&i===0?.1:0))})).sort((a,b)=>b.score-a.score);
 return <><h1>Your idea lands here.</h1>{error&&<p role="alert">Matching unavailable: {error}</p>}{!embedding&&!error&&<p role="status">Finding semantic matches...</p>}{embedding?.warning&&<p role="alert">{embedding.warning}</p>}{embedding&&<div className="notice"><strong>{embedding.themes[0]?.name}</strong><p>{embedding.themes[0]?.description} Your wording also touches {embedding.themes[1]?.name.toLowerCase()}.</p></div>}
 <div className="tabs"><a className="active" href="#faculty">Faculty</a><a href="#groups">Groups</a><a href="#students">Students</a></div>
 <section id="faculty"><h2>Faculty matches</h2><div className="grid">{fm.slice(0,6).map(({p,paper,signal,score,reason},i)=><article className="card" key={p.id}><span className="meta">{Math.round(score*100)}% topical fit</span><div className="strength"><i style={{width:`${score*100}%`}}/></div><h3>{p.name}</h3><p>{p.title}, {p.departments[0]}</p><p><strong>Why this match:</strong> {reason}</p><div className="chips"><span className="chip">{signal.recent_output} papers since {embedding?.recent_cutoff}</span><span className="chip">latest publication {signal.publication_recency}</span>{opted&&i===0&&<span className="chip">explicitly open to students</span>}</div><a href={p.profile_url}>View source profile</a></article>)}</div></section>
 <section id="groups" style={{marginTop:50}}><h2>Research groups</h2><div className="grid">{(embedding?.groups || []).map(g=><article className="card" key={g.id}><h3>{g.name}</h3><p><strong>Why this match:</strong> Shared output sits in {g.theme_name}.</p><div className="chips"><span className="chip">{g.member_ids.length} collaborators</span><span className="chip">{g.publication_ids.length} shared works</span></div><Link href={`/groups/${g.id}`}>Explore group</Link></article>)}</div></section>
 <section id="students" style={{marginTop:50}}><h2>Student collaborators</h2><div className="grid">{(embedding?.students || []).map((s,i)=><article className="card" key={s.id}><span className="meta">{Math.round(s.score*100)}% topical fit</span><h3>{s.name}</h3><p>{s.idea}</p><p><strong>Why this match:</strong> Shared theme, complementary skills in {s.skills.join(' and ')}.</p></article>)}</div></section></>
}
