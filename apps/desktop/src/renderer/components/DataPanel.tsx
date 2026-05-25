import React, { useState } from 'react'
import { FetchedArticle, FinanceData } from '../../main/dataFetcher'

interface DataPanelProps {
  selectedCategories: string[]
}

export const DataPanel: React.FC<DataPanelProps> = ({ selectedCategories }) => {
  const [articles, setArticles]     = useState<FetchedArticle[]>([])
  const [finance, setFinance]       = useState<FinanceData[]>([])
  const [loading, setLoading]       = useState(false)
  const [lastFetch, setLastFetch]   = useState<string>('')

  const handleFetch = async () => {
    setLoading(true)
    try {
      const api = (window as any).electronAPI
      const [dataResult, financeResult] = await Promise.all([
        api.fetchData(selectedCategories),
        api.fetchFinance(),
      ])

        const categoryArrays = Object.values(dataResult) as FetchedArticle[][]
        const allArticles: FetchedArticle[] = []
        const maxLen = Math.max(...categoryArrays.map(a => a.length))
            for (let i = 0; i < maxLen; i++) {
                for (const arr of categoryArrays) {
                    if (arr[i]) allArticles.push(arr[i])
                }
            }
      setArticles(allArticles)
      setFinance(financeResult)
      setLastFetch(new Date().toLocaleTimeString())
    } catch (err) {
      console.error('Fetch failed:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatChange = (change: number, pct: number) => {
    const sign = change >= 0 ? '+' : ''
    return `${sign}${change.toFixed(2)} (${sign}${pct.toFixed(2)}%)`
  }

  return (
    <div className="data-panel">
      <div className="data-controls">
        <button
          className="btn btn-fetch"
          onClick={handleFetch}
          disabled={loading}
        >
          {loading ? 'Fetching...' : '🌐 Fetch Live Data'}
        </button>
        {lastFetch && (
          <span className="last-fetch">Last fetch: {lastFetch}</span>
        )}
      </div>

      {finance.length > 0 && (
        <div className="finance-row">
          {finance.slice(0, 4).map(f => (
            <div key={f.symbol} className="finance-ticker">
              <span className="ticker-symbol">{f.symbol}</span>
              <span className="ticker-price">${f.price.toFixed(2)}</span>
              <span className={`ticker-change ${f.change >= 0 ? 'positive' : 'negative'}`}>
                {formatChange(f.change, f.changePercent)}
              </span>
            </div>
          ))}
        </div>
      )}

      {articles.length > 0 && (
        <div className="article-list">
          {articles.slice(0, 5).map((a, i) => (
            <div key={i} className="article-row">
              <span className="article-category">{a.category}</span>
              <span className="article-title">{a.title}</span>
              <span className="article-source">{a.source}</span>
            </div>
          ))}
          {articles.length > 5 && (
            <p className="more-label">+{articles.length - 5} more articles fetched</p>
          )}
        </div>
      )}

      {!loading && articles.length === 0 && (
        <p className="placeholder-text">
          Click Fetch Live Data to pull current headlines
        </p>
      )}
    </div>
  )
}