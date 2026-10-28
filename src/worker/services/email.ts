// Email notification service
interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(env: any, options: EmailOptions): Promise<boolean> {
  // Using a simple SMTP or third-party email service
  // For production, integrate with SendGrid, Mailgun, or similar

  try {
    // Placeholder implementation - replace with actual email service
    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
      console.warn('Email service not configured');
      return false;
    }

    // Here you would integrate with your actual email service
    // For now, we'll log the email
    console.log(`Email sent to ${options.to}: ${options.subject}`);

    return true;
  } catch (error) {
    console.error('Failed to send email:', error);
    return false;
  }
}

export function generateAuditCompletionEmail(
  websiteDomain: string,
  overallScore: number,
  reportUrl: string
): string {
  const scoreColor = overallScore >= 80 ? '#10b981' :
                     overallScore >= 60 ? '#f59e0b' : '#ef4444';

  return `
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #0066cc; }
        .score-box {
          text-align: center;
          padding: 30px;
          background: #f9fafb;
          border-radius: 8px;
          margin: 20px 0;
        }
        .score-value {
          font-size: 48px;
          font-weight: bold;
          color: ${scoreColor};
        }
        .button {
          display: inline-block;
          background: #0066cc;
          color: white;
          padding: 12px 30px;
          border-radius: 6px;
          text-decoration: none;
          margin: 20px 0;
        }
        .footer {
          text-align: center;
          color: #6b7280;
          font-size: 12px;
          margin-top: 30px;
          border-top: 1px solid #e5e7eb;
          padding-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>SEO Audit Complete</h1>
        </div>

        <p>Hi,</p>

        <p>Your SEO audit for <strong>${websiteDomain}</strong> is now complete!</p>

        <div class="score-box">
          <div class="score-value">${overallScore}</div>
          <p style="margin-top: 10px; color: #6b7280;">Overall SEO Score</p>
        </div>

        <p>Your comprehensive audit report includes:</p>
        <ul>
          <li>On-page SEO analysis</li>
          <li>Technical SEO metrics</li>
          <li>Indexability report</li>
          <li>Internal linking analysis</li>
          <li>Actionable recommendations</li>
        </ul>

        <center>
          <a href="${reportUrl}" class="button">View Full Report</a>
        </center>

        <div class="footer">
          <p>© ${new Date().getFullYear()} RoundSEO. All rights reserved.</p>
          <p>You're receiving this email because you requested an SEO audit.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

export function generateRecommendationEmail(
  websiteDomain: string,
  recommendations: Array<{ title: string; priority: string }>,
  reportUrl: string
): string {
  return `
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; padding: 20px 0; border-bottom: 2px solid #0066cc; }
        .rec-item {
          background: #f9fafb;
          padding: 16px;
          margin: 10px 0;
          border-left: 4px solid #f59e0b;
          border-radius: 4px;
        }
        .rec-item.critical {
          border-left-color: #ef4444;
          background: #fef2f2;
        }
        .button {
          display: inline-block;
          background: #0066cc;
          color: white;
          padding: 12px 30px;
          border-radius: 6px;
          text-decoration: none;
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>SEO Recommendations</h1>
        </div>

        <p>Hi,</p>

        <p>We've identified ${recommendations.length} recommendations to improve SEO for <strong>${websiteDomain}</strong>:</p>

        ${recommendations.map(rec => `
          <div class="rec-item ${rec.priority === 'critical' ? 'critical' : ''}">
            <strong>${rec.title}</strong>
            <p style="margin-top: 8px; color: #6b7280; font-size: 12px;">Priority: ${rec.priority.toUpperCase()}</p>
          </div>
        `).join('')}

        <center>
          <a href="${reportUrl}" class="button">View Detailed Report</a>
        </center>
      </div>
    </body>
    </html>
  `;
}
