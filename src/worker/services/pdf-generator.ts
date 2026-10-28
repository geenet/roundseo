// PDF report generator
export interface ReportData {
  website: {
    domain: string;
    url: string;
  };
  audit: {
    id: string;
    startedAt: string;
    completedAt?: string;
  };
  metrics: {
    overallScore: number;
    onPageScore: number;
    technicalScore: number;
    indexabilityScore: number;
    internalLinkingScore: number;
    totalPages: number;
    indexablePages: number;
  };
  recommendations: Array<{
    category: string;
    priority: string;
    title: string;
    description: string;
  }>;
}

export function generateHTMLReport(data: ReportData): string {
  const date = new Date().toLocaleDateString();
  const scoreColor = data.metrics.overallScore >= 80 ? '#10b981' :
                     data.metrics.overallScore >= 60 ? '#f59e0b' : '#ef4444';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>SEO Audit Report - ${data.website.domain}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          color: #1f2937;
          line-height: 1.6;
        }
        .container {
          max-width: 800px;
          margin: 0 auto;
          padding: 40px 20px;
        }
        header {
          text-align: center;
          margin-bottom: 40px;
          border-bottom: 3px solid #0066cc;
          padding-bottom: 20px;
        }
        h1 {
          font-size: 28px;
          margin-bottom: 10px;
        }
        .subtitle {
          color: #6b7280;
          font-size: 16px;
        }
        .score-section {
          background: #f9fafb;
          border-radius: 8px;
          padding: 30px;
          margin: 30px 0;
          text-align: center;
        }
        .score-circle {
          width: 120px;
          height: 120px;
          border-radius: 50%;
          background: ${scoreColor};
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 48px;
          font-weight: bold;
          margin: 0 auto 20px;
        }
        .score-label {
          font-size: 14px;
          color: #6b7280;
          margin-top: 10px;
        }
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 20px;
          margin: 30px 0;
        }
        .metric-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 20px;
        }
        .metric-value {
          font-size: 24px;
          font-weight: bold;
          color: #0066cc;
        }
        .metric-label {
          font-size: 14px;
          color: #6b7280;
          margin-top: 8px;
        }
        h2 {
          font-size: 20px;
          margin: 30px 0 15px;
          border-left: 4px solid #0066cc;
          padding-left: 12px;
        }
        .recommendation {
          background: white;
          border-left: 4px solid #f59e0b;
          padding: 16px;
          margin: 12px 0;
          border-radius: 4px;
        }
        .recommendation.critical {
          border-left-color: #ef4444;
        }
        .recommendation.low {
          border-left-color: #10b981;
        }
        .rec-title {
          font-weight: 600;
          margin-bottom: 4px;
        }
        .rec-priority {
          display: inline-block;
          font-size: 12px;
          padding: 2px 8px;
          border-radius: 4px;
          background: #fef3c7;
          color: #b45309;
          margin-top: 8px;
        }
        .rec-priority.critical {
          background: #fee2e2;
          color: #991b1b;
        }
        footer {
          text-align: center;
          color: #9ca3af;
          font-size: 12px;
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>SEO Audit Report</h1>
          <p class="subtitle">${data.website.domain}</p>
          <p class="subtitle">Generated on ${date}</p>
        </header>

        <div class="score-section">
          <div class="score-circle">${data.metrics.overallScore}</div>
          <div style="font-size: 18px; font-weight: 600; color: #1f2937;">Overall SEO Score</div>
          <div class="score-label">
            ${data.metrics.overallScore >= 80 ? 'Excellent' :
              data.metrics.overallScore >= 60 ? 'Good' :
              data.metrics.overallScore >= 40 ? 'Fair' : 'Poor'}
          </div>
        </div>

        <h2>Key Metrics</h2>
        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-value">${data.metrics.onPageScore}</div>
            <div class="metric-label">On-Page Score</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${data.metrics.technicalScore}</div>
            <div class="metric-label">Technical Score</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${data.metrics.indexabilityScore}</div>
            <div class="metric-label">Indexability Score</div>
          </div>
          <div class="metric-card">
            <div class="metric-value">${data.metrics.internalLinkingScore}</div>
            <div class="metric-label">Internal Linking Score</div>
          </div>
        </div>

        <h2>Crawl Overview</h2>
        <div class="metric-card" style="margin-bottom: 20px;">
          <p>Total Pages Crawled: <strong>${data.metrics.totalPages}</strong></p>
          <p>Indexable Pages: <strong>${data.metrics.indexablePages}</strong></p>
          <p>Non-Indexable Pages: <strong>${data.metrics.totalPages - data.metrics.indexablePages}</strong></p>
        </div>

        <h2>Recommendations</h2>
        ${data.recommendations.length > 0 ? data.recommendations.map(rec => `
          <div class="recommendation ${rec.priority === 'critical' ? 'critical' : rec.priority === 'low' ? 'low' : ''}">
            <div class="rec-title">${rec.title}</div>
            <div>${rec.description}</div>
            <span class="rec-priority ${rec.priority === 'critical' ? 'critical' : ''}">${rec.priority.toUpperCase()}</span>
          </div>
        `).join('') : '<p style="color: #6b7280;">No critical recommendations at this time.</p>'}

        <footer>
          <p>© ${new Date().getFullYear()} RoundSEO. All rights reserved.</p>
          <p>This report was automatically generated and should not be considered professional SEO advice.</p>
        </footer>
      </div>
    </body>
    </html>
  `;
}

export async function uploadReportToR2(
  s3Client: any,
  reportId: string,
  html: string
): Promise<string> {
  const key = `reports/${reportId}-${Date.now()}.html`;

  await s3Client.putObject({
    Bucket: 'roundseo-reports',
    Key: key,
    Body: html,
    ContentType: 'text/html',
  });

  return key;
}
