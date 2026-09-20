"""Read-only Streamlit interface to the existing Orange Coauthor index.

Run from the repository root: python -m streamlit run streamlit_app/app.py
"""

import json
import math
import re
from html import escape
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode

import numpy as np
import streamlit as st


ROOT = Path(__file__).resolve().parents[1]
STOPWORDS = set("a an and are as at be been by can for from has have in into is it its of on or our that the their this to using via was were with within study studies research analysis approach based effects effect new role among between toward towards".split())


@st.cache_data
def load_data(corpus_stamp, index_stamp, student_stamp):
    # Modification times invalidate the cache without writing to the pipeline.
    corpus = json.loads((ROOT / "data/corpus.json").read_text(encoding="utf-8"))
    index = json.loads((ROOT / "data/index.json").read_text(encoding="utf-8"))
    path = ROOT / "data/students.json"
    students = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    return corpus, index, students


def embed(text, embedding):
    """Apply the builder's tokenization, sublinear TF, stored IDF and L2 norm."""
    # [^\W_] matches Unicode letters and numbers, excluding underscores.
    words = re.findall(r"[^\W_](?:[^\W_]|-){2,}", text.lower())
    counts = Counter(word for word in words if word not in STOPWORDS)
    vector = np.array([
        (1 + math.log(counts[word])) * weight if counts[word] else 0.0
        for word, weight in zip(embedding["vocabulary"], embedding["idf"])
    ])
    norm = np.linalg.norm(vector)
    return vector / norm if norm else vector


def canonical_view(view):
    return {"Theme detail": "Themes", "Post an idea": "Student", "Matches": "Student"}.get(view, view)


def local_link(view, **params):
    return "?" + urlencode({"view": canonical_view(view), **params})


def source_link(label, url):
    if url and url.startswith("?"):
        counts = st.session_state.setdefault("link_counts", {})
        occurrence = counts.get(url, 0)
        counts[url] = occurrence + 1
        if st.button(label, key=f"link:{url}:{occurrence}"):
            params = dict(parse_qsl(url[1:]))
            st.query_params.clear()
            st.query_params.update(params)
            st.session_state.pending_view = params["view"]
            st.rerun()
    elif url and url.startswith(("https://", "http://")):
        st.link_button(label, url)


def faculty_ranking(vector, people, index, open_ids):
    centroids = np.asarray([theme["centroid"] for theme in index["themes"]])
    query_themes = centroids @ vector
    year = datetime.now(timezone.utc).year
    results = []
    for person in people:
        pv = np.asarray(index["vectors"]["people"][person["id"]])
        signal = index["signals"][person["id"]]
        theme_fit = max(0.0, float(np.max(query_themes * (centroids @ pv))))
        recency = max(0, 1 - (year - signal["publication_recency"]) / 4)
        score = (.55 * theme_fit + .25 * max(0, float(vector @ pv))
                 + .12 * recency + .08 * min(1, signal["recent_output"] / 8))
        if person["id"] in open_ids:
            score += .1
        results.append((score, person))
    return sorted(results, key=lambda item: item[0], reverse=True)


def main():
    st.session_state.link_counts = {}
    st.set_page_config(page_title="Orange Coauthor", page_icon="🍊", layout="wide")
    st.html(Path(__file__).with_name("palette.css"))
    try:
        paths = [ROOT / "data" / name for name in ("corpus.json", "index.json", "students.json")]
        with st.spinner("Loading the research landscape?"):
            corpus, index, students = load_data(*(p.stat().st_mtime_ns if p.exists() else None for p in paths))
    except (OSError, ValueError) as error:
        st.error(f"Could not read the existing data files: {error}")
        st.stop()
    people = {p["id"]: p for p in corpus["people"]}
    papers = {p["id"]: p for p in corpus["publications"]}
    themes = {t["id"]: t for t in index["themes"]}
    if not themes:
        st.info("No research themes are available in the index.")
        return
    centroids = np.asarray([t["centroid"] for t in themes.values()])
    st.session_state.setdefault("idea", "climate health data")
    st.session_state.setdefault("availability", {})
    open_ids = {pid for pid in people if st.session_state.availability.get(pid, index["signals"].get(pid, {}).get("opted_in", False))}

    def nearest(vector):
        return list(themes.values())[int(np.argmax(centroids @ vector))]

    def paper_card(paper):
        st.html(f'<p class="publication-title">{escape(paper["title"])}</p>')
        st.caption(f"{paper.get('venue', '')} · {paper.get('year', '')}")
        source_link("View source publication", paper.get("url"))

    def person_card(person, score=None):
        with st.container(border=True):
            st.subheader(person["name"])
            st.write(f"{person.get('title', '')} · {', '.join(person.get('departments', []))}")
            if score is not None:
                st.caption(f"Ranking score: {score:.3f} (not a probability)")
            st.write("**Cached explanation:**", index["explanations"].get(person["id"], "No cached explanation available."))
            signal = index["signals"].get(person["id"], {})
            st.caption(f"{signal.get('recent_output', 0)} papers since {index['meta']['recent_cutoff']} · Latest publication: {signal.get('publication_recency', 'unknown')}")
            if person["id"] in open_ids:
                st.write("Open to students · session availability")
            person_themes = [t for t in themes.values() if person["id"] in t["person_ids"]]
            for theme in person_themes:
                st.write(f"**{theme['name']}:** {theme['description']}")
            if not person_themes:
                st.caption("No indexed themes for this person.")
            source_link("View source profile", person.get("profile_url"))

    def group_card(group, score=None):
        with st.container(border=True):
            st.subheader(group["name"])
            theme = themes[group["theme_id"]]
            if score is not None:
                st.caption(f"Theme similarity: {score:.3f}")
            st.write(f"{len(group['member_ids'])} collaborators · {len(group['publication_ids'])} shared works")
            st.write("**Stored theme evidence:**", theme["description"])
            st.caption("No group-specific cached explanation is present in the index.")
            st.write("**Theme:**", theme["name"])
            with st.expander("Explore group ? members, shared output and source record", expanded=st.query_params.get("record") == group["id"]):
                st.write("A co-authorship group retained for multiple shared works and current output.")
                st.write("**Collaborators**")
                for member_id in group["member_ids"]:
                    if member_id in people:
                        member = people[member_id]
                        st.write(member["name"])
                        source_link("View collaborator profile", member.get("profile_url"))
                st.write("**Recent shared output**")
                for paper_id in group["publication_ids"]:
                    if paper_id in papers:
                        paper_card(papers[paper_id])
                st.caption("Source group record ? data/index.json")
                st.json(group)

    def student_card(student, score=None):
        with st.container(border=True):
            st.subheader(student["name"])
            st.write(student["idea"])
            st.caption("Skills: " + ", ".join(student.get("skills", [])))
            st.caption("Courses: " + ", ".join(student.get("courses", [])))
            if score is not None:
                st.caption(f"Text similarity: {score:.3f}")
            sv = embed(student["idea"], index["embedding"])
            if np.any(sv):
                theme = nearest(sv)
                st.write("**Theme:**", theme["name"])
                st.write("**Stored theme evidence:**", theme["description"])
            st.caption("No student-specific cached explanation is present. This is a demo student post.")
            source_link("View source student record", local_link("Matches", record=f"student-{student['id']}"))

    st.sidebar.title("Orange Coauthor")
    st.session_state["link_counts"] = {}
    views = ["Themes", "Student", "Faculty"]
    requested = canonical_view(st.query_params.get("view", "Themes"))
    if "pending_view" in st.session_state:
        st.session_state.navigation = canonical_view(st.session_state.pop("pending_view"))
    st.session_state.setdefault("navigation", requested if requested in views else "Themes")
    if st.session_state.navigation not in views:
        st.session_state.navigation = canonical_view(st.session_state.navigation)
    def navigate():
        st.query_params.clear()
        st.query_params["view"] = st.session_state.navigation
    view = st.sidebar.radio("Explore", views, key="navigation", on_change=navigate)
    st.query_params["view"] = view
    st.sidebar.caption("Reads the existing corpus and index. Ideas and availability are kept only in this session.")
    st.sidebar.caption(corpus.get("meta", {}).get("source", ""))
    if corpus.get("meta", {}).get("synthetic"):
        st.warning("This corpus contains synthetic demo records.")

    if view == "Themes":
        st.title("Explore research themes")
        if st.button("Place your idea on the map", type="primary"):
            st.query_params.clear()
            st.session_state.pending_view = "Student"
            st.rerun()
        st.write(f"{len(themes)} themes · {len(people)} faculty and researchers · {len(papers)} publications")
        search = st.text_input("Search themes")
        visible = [t for t in themes.values() if search.lower() in (t["name"] + " " + t["description"]).lower()]
        columns = st.columns(3)
        for position, theme in enumerate(visible):
            with columns[position % 3], st.container(border=True):
                st.subheader(theme["name"])
                st.write(theme["description"])
                st.caption(f"{theme['faculty_count']} faculty · {theme['publication_count']} publications")
                source_link("Explore theme", local_link("Theme detail", theme=theme["id"]))
        if not visible:
            st.info("No themes match your search.")

    if view == "Themes" and (st.query_params.get("theme") or st.query_params.get("record")):
        ids = list(themes)
        selected = st.query_params.get("theme", ids[0])
        tid = st.selectbox("Theme", ids, index=ids.index(selected) if selected in ids else 0, format_func=lambda key: themes[key]["name"])
        theme = themes[tid]
        st.title(theme["name"])
        st.write(theme["description"])
        st.caption(f"{theme['faculty_count']} faculty · {theme['publication_count']} publications · {theme['recent_publications']} recent")
        record = st.query_params.get("record")
        if record:
            group = next((g for g in index["groups"] if g["id"] == record), None)
            if group:
                st.subheader("Source group record · data/index.json")
                st.json(group)
        faculty_tab, group_tab, paper_tab = st.tabs(["Faculty", "Groups", "Top papers"])
        with faculty_tab:
            if not any(pid in people for pid in theme["person_ids"]):
                st.info("No faculty profiles are available in this theme.")
            for pid in theme["person_ids"]:
                if pid in people:
                    person_card(people[pid])
        with group_tab:
            groups = [g for g in index["groups"] if g["theme_id"] == tid]
            for group in groups:
                group_card(group)
            if not groups:
                st.info("No indexed co-authorship groups in this theme.")
        with paper_tab:
            if not any(pid in papers for pid in theme["representative_publications"]):
                st.info("No defining papers are available in this theme.")
            for pid in theme["representative_publications"]:
                if pid in papers:
                    paper_card(papers[pid])

    elif view == "Student":
        st.title("What are you curious about?")
        with st.form("idea_form"):
            idea = st.text_area("Your research idea", value=st.session_state.idea, height=180)
            courses = st.text_input("Courses taken", value=st.session_state.get("idea_post", {}).get("courses", ""))
            hour_options = ["3–5 hours", "6–10 hours", "10+ hours"]
            hours = st.selectbox("Hours per week", hour_options, index=hour_options.index(st.session_state.get("idea_post", {}).get("hours", hour_options[0])))
            timeline_options = ["This semester", "Next semester", "Summer"]
            timeline = st.selectbox("Timeline", timeline_options, index=timeline_options.index(st.session_state.get("idea_post", {}).get("timeline", timeline_options[0])))
            submitted = st.form_submit_button("Find where this idea fits", type="primary")
        if submitted:
            vector = embed(idea, index["embedding"])
            if not idea.strip():
                st.warning("Enter a research idea first.")
            elif not np.any(vector):
                st.warning("No words overlap the stored vocabulary. Add more specific research terms.")
            else:
                st.session_state.idea = idea
                st.session_state.idea_post = dict(idea=idea, courses=courses, hours=hours, timeline=timeline)
        st.subheader("Matches for your idea")
        record = st.query_params.get("record", "")
        student = next((s for s in students if record == f"student-{s['id']}"), None)
        if student:
            st.subheader("Source student record · data/students.json")
            st.json(student)
        query = st.session_state.idea
        vector = embed(query, index["embedding"])
        if not np.any(vector):
            st.info("Enter an idea containing research terms from the stored vocabulary to see matches.")
            return
        theme = nearest(vector)
        st.success(f"Your idea lands in: {theme['name']}")
        st.write(theme["description"])
        faculty_results = faculty_ranking(vector, corpus["people"], index, open_ids)
        if faculty_results:
            st.html(f'<p class="match-strength">Strongest faculty match: {faculty_results[0][0]:.3f} ranking score (not a probability)</p>')
        faculty_tab, group_tab, student_tab = st.tabs(["Faculty", "Groups", "Students"])
        with faculty_tab:
            if not people:
                st.info("No faculty profiles are available.")
            for score, person in faculty_results[:12]:
                person_card(person, score)
        with group_tab:
            ranked = sorted(((float(vector @ np.asarray(themes[g["theme_id"]]["centroid"])), g) for g in index["groups"]), key=lambda pair: pair[0], reverse=True)
            for score, group in ranked[:6]:
                group_card(group, score)
            if not ranked:
                st.info("No groups are available in the index.")
        with student_tab:
            ranked = sorted(((float(vector @ embed(s["idea"], index["embedding"])), s) for s in students), key=lambda pair: pair[0], reverse=True)
            for score, student in ranked[:6]:
                student_card(student, score)
            if not students:
                st.info("No student posts are available.")

    elif view == "Faculty":
        st.title("Student ideas near your work")
        if not people:
            st.info("No faculty profiles are available.")
            return
        pid = st.selectbox("Demo faculty profile", list(people), format_func=lambda key: people[key]["name"])
        st.caption("Session-only demo control. Publication activity does not imply availability.")
        with st.container(key="availability_action"):
            is_open = st.toggle("Open to students this semester", value=pid in open_ids, key=f"open_{pid}")
        st.session_state.availability[pid] = is_open
        source_link("View source profile", people[pid].get("profile_url"))
        st.subheader("Your research themes")
        own_themes = [t for t in themes.values() if pid in t["person_ids"]]
        for theme in own_themes:
            with st.expander(theme["name"]):
                st.write(theme["description"])
                st.caption(f"{theme['faculty_count']} faculty ? {theme['publication_count']} publications ? {theme['recent_publications']} recent")
                source_link("Explore theme", local_link("Themes", theme=theme["id"]))
        if not own_themes:
            st.info("No indexed themes for this person.")
        st.subheader("Relevant student posts")
        vector = np.asarray(index["vectors"]["people"][pid])
        ranked = sorted(((float(vector @ embed(s["idea"], index["embedding"])), s) for s in students), key=lambda pair: pair[0], reverse=True)
        if ranked:
            st.html(f'<p class="match-strength">Strongest student match: {ranked[0][0]:.3f} text similarity (not a probability)</p>')
        for score, student in ranked[:6]:
            student_card(student, score)
        if not students:
            st.info("No student posts are available.")


if __name__ == "__main__":
    main()
