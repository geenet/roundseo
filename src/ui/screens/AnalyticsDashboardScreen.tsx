import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8789';

interface MetricCard {
  title: string;
  value: string | number;
  unit?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

interface DashboardData {
  overallScore: number;
  onPageScore: number;
  technicalScore: number;
  indexabilityScore: number;
  internalLinkingScore: number;
  totalPages: number;
  indexablePages: number;
  pagesWithIssues: number;
  topKeywords: Array<{
    keyword: string;
    rank: number;
    volume: number;
    traffic: number;
  }>;
  recentRecommendations: Array<{
    title: string;
    priority: string;
  }>;
}

export default function AnalyticsDashboardScreen({ route, navigation }: any) {
  const { websiteId } = route.params;
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMetric, setSelectedMetric] = useState<'overall' | 'scores' | 'keywords'>('overall');

  useEffect(() => {
    loadAnalytics();
  }, [websiteId]);

  const loadAnalytics = async () => {
    try {
      const token = await SecureStore.getItemAsync('authToken');

      // Fetch audit data
      const auditResponse = await fetch(`${API_URL}/api/v2/websites/${websiteId}/audits`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // Fetch keyword data
      const keywordResponse = await fetch(`${API_URL}/api/v2/websites/${websiteId}/keywords`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const auditData = await auditResponse.json() as { metrics?: Omit<DashboardData, 'topKeywords' | 'recentRecommendations' | 'pagesWithIssues'>; recommendations?: DashboardData['recentRecommendations'] };
      const keywordData = await keywordResponse.json() as { keywords?: DashboardData['topKeywords'] };

      // Combine data for dashboard
      const metrics = auditData.metrics || {
        overallScore: 0,
        onPageScore: 0,
        technicalScore: 0,
        indexabilityScore: 0,
        internalLinkingScore: 0,
        totalPages: 0,
        indexablePages: 0,
      };

      setData({
        ...metrics,
        pagesWithIssues: metrics.totalPages - metrics.indexablePages,
        topKeywords: (keywordData.keywords || []).slice(0, 5),
        recentRecommendations: (auditData.recommendations || []).slice(0, 5),
      });
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0066cc" />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Failed to load analytics</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadAnalytics}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Analytics</Text>
      </View>

      {/* Overall Score Card */}
      <View style={styles.scoreSection}>
        <View style={[styles.scoreCircle, { backgroundColor: getScoreColor(data.overallScore) }]}>
          <Text style={styles.scoreValue}>{Math.round(data.overallScore)}</Text>
        </View>
        <Text style={styles.scoreLabel}>Overall SEO Score</Text>
        <Text style={styles.scoreDescription}>
          {getScoreDescription(data.overallScore)}
        </Text>
      </View>

      {/* Metric Tabs */}
      <View style={styles.tabContainer}>
        {(['overall', 'scores', 'keywords'] as const).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tab,
              selectedMetric === tab && styles.tabActive,
            ]}
            onPress={() => setSelectedMetric(tab)}
          >
            <Text style={[
              styles.tabText,
              selectedMetric === tab && styles.tabTextActive,
            ]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Overall Metrics */}
      {selectedMetric === 'overall' && (
        <View style={styles.metricsGrid}>
          <MetricCard
            title="Total Pages"
            value={data.totalPages}
            color="#3b82f6"
          />
          <MetricCard
            title="Indexable Pages"
            value={data.indexablePages}
            color="#10b981"
          />
          <MetricCard
            title="Pages with Issues"
            value={data.pagesWithIssues}
            color="#ef4444"
          />
        </View>
      )}

      {/* Score Breakdown */}
      {selectedMetric === 'scores' && (
        <View style={styles.metricsGrid}>
          <MetricCard
            title="On-Page"
            value={Math.round(data.onPageScore)}
            color="#0066cc"
          />
          <MetricCard
            title="Technical"
            value={Math.round(data.technicalScore)}
            color="#7c3aed"
          />
          <MetricCard
            title="Indexability"
            value={Math.round(data.indexabilityScore)}
            color="#06b6d4"
          />
          <MetricCard
            title="Internal Linking"
            value={Math.round(data.internalLinkingScore)}
            color="#ec4899"
          />
        </View>
      )}

      {/* Keywords */}
      {selectedMetric === 'keywords' && (
        <View style={styles.keywordsList}>
          <Text style={styles.sectionTitle}>Top Keywords</Text>
          {data.topKeywords.length > 0 ? (
            data.topKeywords.map((kw, idx) => (
              <View key={idx} style={styles.keywordCard}>
                <View style={styles.keywordHeader}>
                  <Text style={styles.keyword}>{kw.keyword}</Text>
                  <Text style={styles.rank}>#{kw.rank}</Text>
                </View>
                <View style={styles.keywordStats}>
                  <Text style={styles.stat}>Vol: {kw.volume}</Text>
                  <Text style={styles.stat}>Traffic: {kw.traffic}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.noData}>No keywords tracked yet</Text>
          )}
        </View>
      )}

      {/* Recommendations Section */}
      {data.recentRecommendations.length > 0 && (
        <View style={styles.recommendationsSection}>
          <Text style={styles.sectionTitle}>Recent Recommendations</Text>
          {data.recentRecommendations.map((rec, idx) => (
            <View key={idx} style={[
              styles.recommendationCard,
              rec.priority === 'critical' && styles.recommendationCritical,
              rec.priority === 'high' && styles.recommendationHigh,
            ]}>
              <View style={styles.recPriority}>
                <Text style={styles.recPriorityText}>{rec.priority.toUpperCase()}</Text>
              </View>
              <Text style={styles.recTitle}>{rec.title}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Refresh Button */}
      <TouchableOpacity style={styles.refreshButton} onPress={loadAnalytics}>
        <Text style={styles.refreshButtonText}>Refresh Data</Text>
      </TouchableOpacity>

      <View style={styles.spacer} />
    </ScrollView>
  );
}

// Metric Card Component
function MetricCard({ title, value, color }: { title: string; value: string | number; color?: string }) {
  return (
    <View style={[styles.metricCard, { borderLeftColor: color || '#0066cc' }]}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricTitle}>{title}</Text>
    </View>
  );
}

// Helper functions
function getScoreColor(score: number): string {
  if (score >= 80) return '#10b981'; // Green
  if (score >= 60) return '#f59e0b'; // Orange
  return '#ef4444'; // Red
}

function getScoreDescription(score: number): string {
  if (score >= 80) return 'Excellent - Great SEO performance';
  if (score >= 60) return 'Good - Room for improvement';
  if (score >= 40) return 'Fair - Significant improvements needed';
  return 'Poor - Major SEO issues to address';
}

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  backButton: {
    color: '#0066cc',
    fontSize: 16,
    marginRight: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  scoreSection: {
    alignItems: 'center',
    padding: 30,
    backgroundColor: 'white',
    marginVertical: 10,
  },
  scoreCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  scoreValue: {
    fontSize: 48,
    fontWeight: 'bold',
    color: 'white',
  },
  scoreLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  scoreDescription: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#0066cc',
  },
  tabText: {
    fontSize: 14,
    color: '#6b7280',
  },
  tabTextActive: {
    color: '#0066cc',
    fontWeight: '600',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 10,
  },
  metricCard: {
    width: '48%',
    backgroundColor: 'white',
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 16,
    marginHorizontal: '1%',
    marginVertical: 8,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
  },
  metricTitle: {
    fontSize: 13,
    color: '#6b7280',
  },
  keywordsList: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  keywordCard: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  keywordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  keyword: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  rank: {
    fontSize: 14,
    color: '#0066cc',
    fontWeight: '600',
  },
  keywordStats: {
    flexDirection: 'row',
    gap: 16,
  },
  stat: {
    fontSize: 12,
    color: '#6b7280',
  },
  recommendationsSection: {
    padding: 16,
  },
  recommendationCard: {
    backgroundColor: 'white',
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
    borderRadius: 6,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  recommendationHigh: {
    borderLeftColor: '#f59e0b',
  },
  recommendationCritical: {
    borderLeftColor: '#ef4444',
  },
  recPriority: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 12,
  },
  recPriorityText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#991b1b',
  },
  recTitle: {
    fontSize: 13,
    color: '#111827',
    fontWeight: '500',
    flex: 1,
  },
  refreshButton: {
    backgroundColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginVertical: 16,
    alignItems: 'center',
  },
  refreshButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 16,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#0066cc',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  retryButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  spacer: {
    height: 20,
  },
  noData: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    paddingVertical: 20,
  },
});
