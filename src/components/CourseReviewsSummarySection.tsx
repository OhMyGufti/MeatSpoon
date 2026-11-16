// src/components/CourseReviewsSummarySection.tsx
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {
  CourseReviewsAiSummary,
  CourseStaffReviewItem,
  getCourseReviewsAiSummary,
  isQuotaExceededError,
} from '../services/courseReviewsAi';

interface CourseReviewsSummarySectionProps {
  courseId: string;
}

function renderStars(rating: number): string {
  const clamped = Math.min(5, Math.max(1, Math.round(rating)));
  return '⭐'.repeat(clamped);
}

export const CourseReviewsSummarySection: React.FC<
  CourseReviewsSummarySectionProps
> = ({ courseId }) => {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summaryData, setSummaryData] = useState<CourseReviewsAiSummary | null>(
    null
  );
  const [fromCache, setFromCache] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [additionalExpanded, setAdditionalExpanded] = useState(false);

  const loadSummary = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setQuotaExceeded(false);
      setErrorMessage(null);

      const res = await getCourseReviewsAiSummary(courseId, { forceRefresh });
      setSummaryData(res.summary);
      setFromCache(res.fromCache);
    } catch (err: any) {
      if (isQuotaExceededError(err)) {
        setQuotaExceeded(true);
      } else {
        setErrorMessage(
          err?.message || 'אירעה שגיאה בעת יצירת סיכום הביקורות.'
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAccordion = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !summaryData && !loading) {
      loadSummary(false);
    }
  };

  const handleForceRefresh = () => {
    if (loading) return;
    if (!expanded) {
      setExpanded(true);
    }
    loadSummary(true);
  };

  const renderStaffCard = (item: CourseStaffReviewItem, index: number) => {
    const isLecturer = item.role.includes('מרצה');
    return (
      <View key={`${item.name}-${index}`} style={styles.staffCard}>
        <View style={styles.staffCardTopRow}>
          <View style={styles.staffRatingBadge}>
            <Text style={styles.staffStarsText}>{renderStars(item.rating)}</Text>
            <Text style={styles.staffNumericRating}>
              ({item.rating.toFixed(1)}/5)
            </Text>
          </View>

          <View style={styles.staffIdentityGroup}>
            <View
              style={[
                styles.rolePill,
                isLecturer ? styles.rolePillLecturer : styles.rolePillTa,
              ]}
            >
              <Text
                style={[
                  styles.rolePillText,
                  isLecturer
                    ? styles.rolePillTextLecturer
                    : styles.rolePillTextTa,
                ]}
              >
                {item.role}
              </Text>
            </View>
            <Text style={styles.staffNameText}>{item.name}</Text>
          </View>
        </View>

        <Text style={styles.staffSummaryText}>{item.summary}</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Accordion Header Bar with Title & Subtle Force Refresh Button */}
      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.headerTitleTouchable}
          activeOpacity={0.75}
          onPress={handleToggleAccordion}
        >
          <Text style={styles.chevronText}>{expanded ? '▲' : '▼'}</Text>
          <View style={styles.titleRowRight}>
            <Text style={styles.headerTitleText}>✨ סיכום ביקורות AI</Text>
            {summaryData && fromCache && !loading && (
              <View style={styles.cachedBadge}>
                <Text style={styles.cachedBadgeText}>שמור במטמון</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.refreshBtn}
          activeOpacity={0.7}
          disabled={loading}
          onPress={handleForceRefresh}
        >
          <Text style={styles.refreshBtnText}>🔄 רענן</Text>
        </TouchableOpacity>
      </View>

      {/* Accordion Body */}
      {expanded && (
        <View style={styles.bodyContainer}>
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color="#7C3AED" />
              <Text style={styles.loadingText}>
                מנתח ביקורות סטודנטים מ-CheeseFork באמצעות Gemini AI...
              </Text>
            </View>
          ) : quotaExceeded ? (
            <View style={styles.quotaFallbackBox}>
              <Text style={styles.quotaFallbackIcon}>⏳</Text>
              <Text style={styles.quotaFallbackText}>
                המערכת עמוסה כרגע, נסה שוב מחר
              </Text>
            </View>
          ) : errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
              <TouchableOpacity
                style={styles.retryInlineBtn}
                onPress={() => loadSummary(true)}
              >
                <Text style={styles.retryInlineBtnText}>נסה שוב</Text>
              </TouchableOpacity>
            </View>
          ) : summaryData ? (
            <View style={styles.contentStack}>
              {/* 1. Distinct Visual Block for General Course Summary */}
              <View style={styles.generalSummaryBlock}>
                <Text style={styles.sectionBlockHeading}>
                  📊 חוות דעת כללית על הקורס
                </Text>
                <Text style={styles.generalSummaryParagraph}>
                  {summaryData.generalCourseSummary}
                </Text>
              </View>

              {/* 2. Staff Cards List/Grid */}
              {summaryData.staff.length > 0 && (
                <View style={styles.staffSection}>
                  <Text style={styles.sectionSubHeading}>
                    👨‍🏫 סגל הקורס ({summaryData.staff.length})
                  </Text>
                  <View style={styles.staffGrid}>
                    {summaryData.staff.map((member, idx) =>
                      renderStaffCard(member, idx)
                    )}
                  </View>
                </View>
              )}

              {/* 3. Collapsible Section at the Bottom for "ביקורות נוספות" */}
              {summaryData.additionalReviews &&
                summaryData.additionalReviews.length > 0 && (
                  <View style={styles.additionalSection}>
                    <TouchableOpacity
                      style={styles.additionalHeaderBtn}
                      activeOpacity={0.75}
                      onPress={() => setAdditionalExpanded((prev) => !prev)}
                    >
                      <Text style={styles.additionalChevron}>
                        {additionalExpanded ? '▲' : '▼'}
                      </Text>
                      <Text style={styles.additionalHeaderTitle}>
                        💬 ביקורות נוספות ({summaryData.additionalReviews.length})
                      </Text>
                    </TouchableOpacity>

                    {additionalExpanded && (
                      <View style={styles.additionalList}>
                        {summaryData.additionalReviews.map((item, idx) =>
                          renderStaffCard(item, idx)
                        )}
                      </View>
                    )}
                  </View>
                )}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    backgroundColor: '#FAF5FF',
    overflow: 'hidden',
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#F3E8FF',
  },
  headerTitleTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: 10,
  },
  titleRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitleText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#5B21B6',
    textAlign: 'right',
  },
  chevronText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6D28D9',
  },
  cachedBadge: {
    backgroundColor: '#EDE9FE',
    borderWidth: 1,
    borderColor: '#C4B5FD',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  cachedBadgeText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#6D28D9',
  },
  refreshBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C4B5FD',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  refreshBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6D28D9',
  },
  bodyContainer: {
    padding: 12,
  },
  loadingBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  loadingText: {
    fontSize: 12.5,
    color: '#5B21B6',
    fontWeight: '600',
    textAlign: 'right',
  },
  quotaFallbackBox: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 8,
    padding: 12,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  quotaFallbackIcon: {
    fontSize: 16,
  },
  quotaFallbackText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#92400E',
    textAlign: 'right',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 10,
    alignItems: 'flex-end',
  },
  errorText: {
    fontSize: 12,
    color: '#B91C1C',
    textAlign: 'right',
    marginBottom: 6,
  },
  retryInlineBtn: {
    backgroundColor: '#DC2626',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  retryInlineBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  contentStack: {
    gap: 12,
  },
  generalSummaryBlock: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderRightWidth: 4,
    borderRightColor: '#7C3AED',
    borderWidth: 1,
    borderColor: '#E9D5FF',
    padding: 10,
  },
  sectionBlockHeading: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#5B21B6',
    textAlign: 'right',
    marginBottom: 4,
  },
  generalSummaryParagraph: {
    fontSize: 13,
    lineHeight: 19,
    color: '#1F2937',
    textAlign: 'right',
  },
  staffSection: {
    gap: 8,
  },
  sectionSubHeading: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4C1D95',
    textAlign: 'right',
  },
  staffGrid: {
    gap: 8,
  },
  staffCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 10,
  },
  staffCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  staffIdentityGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  staffNameText: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#111827',
    textAlign: 'right',
  },
  rolePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  rolePillLecturer: {
    backgroundColor: '#DBEAFE',
    borderColor: '#93C5FD',
  },
  rolePillTa: {
    backgroundColor: '#D1FAE5',
    borderColor: '#6EE7B7',
  },
  rolePillText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  rolePillTextLecturer: {
    color: '#1E40AF',
  },
  rolePillTextTa: {
    color: '#065F46',
  },
  staffRatingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  staffStarsText: {
    fontSize: 11,
  },
  staffNumericRating: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#92400E',
  },
  staffSummaryText: {
    fontSize: 12.5,
    lineHeight: 18,
    color: '#374151',
    textAlign: 'right',
  },
  additionalSection: {
    borderTopWidth: 1,
    borderTopColor: '#E9D5FF',
    paddingTop: 8,
  },
  additionalHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F3E8FF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  additionalHeaderTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#5B21B6',
    textAlign: 'right',
  },
  additionalChevron: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6D28D9',
  },
  additionalList: {
    marginTop: 8,
    gap: 8,
  },
});
