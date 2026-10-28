import React, {useEffect, useState} from 'react';
import {StyleSheet} from 'react-native';
import {Text, Card} from 'react-native-paper';

import {
  formatRecommendation,
  recommendModelTier,
  type ModelRecommendation,
} from '../../services/modelManager/recommend';

export const ModelRecommendBanner: React.FC = () => {
  const [rec, setRec] = useState<ModelRecommendation | null>(null);

  useEffect(() => {
    let alive = true;
    recommendModelTier()
      .then(r => {
        if (alive) setRec(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!rec) return null;

  return (
    <Card style={styles.card} mode="outlined">
      <Card.Content>
        <Text variant="titleSmall" style={styles.title}>
          Rekomendasi model untuk HP ini
        </Text>
        <Text variant="bodySmall" style={styles.body}>
          {formatRecommendation(rec)}
        </Text>
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    backgroundColor: '#141416',
    borderColor: '#1c1c1e',
  },
  title: {color: '#00C2FF', marginBottom: 6, fontWeight: '600'},
  body: {color: '#d1d1d6', lineHeight: 18},
});

export default ModelRecommendBanner;
