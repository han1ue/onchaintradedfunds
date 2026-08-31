"use client";

import { Search, Trophy } from "lucide-react";
import { useState } from "react";
import type { FormEvent } from "react";
import type { LeaderboardPage } from "@/lib/types";
import { ResponsiveLeaderboard } from "./Leaderboard";
import { Button } from "./ui";

const PAGE_SIZE = 50;

export function LeaderboardBrowser({ initialPage, submissionsOpen }: {
  initialPage: LeaderboardPage;
  submissionsOpen: boolean;
}) {
  const [entries, setEntries] = useState(initialPage.entries);
  const [nextCursor, setNextCursor] = useState(initialPage.nextCursor);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchPage(search: string, cursor: string | null) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (search) params.set("q", search);
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/leaderboard?${params.toString()}`);
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.data) throw new Error("LEADERBOARD_LOAD_FAILED");
    return json.data as LeaderboardPage;
  }

  async function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = query.trim();
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(search, null);
      setEntries(page.entries);
      setNextCursor(page.nextCursor);
      setAppliedQuery(search);
    } catch {
      setError("Search could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function clearSearch() {
    setQuery("");
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage("", null);
      setEntries(page.entries);
      setNextCursor(page.nextCursor);
      setAppliedQuery("");
    } catch {
      setError("The leaderboard could not be reloaded. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage(appliedQuery, nextCursor);
      setEntries((current) => {
        const seen = new Set(current.map((entry) => entry.id));
        return [...current, ...page.entries.filter((entry) => !seen.has(entry.id))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      setError("More proposals could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return <>
    <form className="listSearch" role="search" onSubmit={applySearch}>
      <label htmlFor="leaderboard-search">Search proposals</label>
      <div><Search size={16} aria-hidden="true" /><input id="leaderboard-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, ticker, creator, or thesis" maxLength={100} /><Button type="submit" variant="secondary" disabled={loading}>Search</Button>{appliedQuery && <Button type="button" variant="ghost" onClick={clearSearch} disabled={loading}>Clear</Button>}</div>
    </form>
    {entries.length > 0
      ? <ResponsiveLeaderboard entries={entries} submissionsOpen={submissionsOpen} />
      : appliedQuery
        ? <div className="leaderboardEmpty"><Trophy size={24} aria-hidden="true" /><div><strong>No matching proposals</strong><p>Try a ticker, OTF name, creator, or a broader phrase.</p></div></div>
        : <ResponsiveLeaderboard entries={entries} submissionsOpen={submissionsOpen} />}
    <div className="listPagination" aria-live="polite">
      <span>{appliedQuery ? `${entries.length} matching ${entries.length === 1 ? "proposal" : "proposals"} shown` : `${entries.length} proposals shown`}</span>
      {nextCursor && <Button type="button" variant="secondary" onClick={loadMore} disabled={loading}>{loading ? "Loading…" : "Load more"}</Button>}
    </div>
    {error && <p className="listLoadError" role="alert">{error}</p>}
  </>;
}
