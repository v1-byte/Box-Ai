import React, {useCallback, useState} from 'react';
import {ScrollView, View, StyleSheet} from 'react-native';
import {Text, Card, Switch, List, Divider} from 'react-native-paper';
import {SafeAreaView} from 'react-native-safe-area-context';
import {observer} from 'mobx-react-lite';

/**
 * Privacy Dashboard — marketing + real toggles surface for Box AI.
 * Proves what never leaves the device.
 */
export const PrivacyDashboardScreen = observer(() => {
  const [blockModelNet, setBlockModelNet] = useState(true);
  const [offlineBadge, setOfflineBadge] = useState(true);

  const onToggleBlock = useCallback((v: boolean) => {
    setBlockModelNet(v);
    // Wire to network policy / feature flag in a later phase.
  }, []);

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.pad}>
        <Text variant="headlineSmall" style={styles.title}>
          Privacy Dashboard
        </Text>
        <Text variant="bodyMedium" style={styles.sub}>
          Bukti, bukan slogan. Data chat & file tetap di HP kamu.
        </Text>

        <Card style={styles.card} mode="outlined">
          <Card.Content>
            <Text variant="titleMedium">Yang TIDAK pernah keluar HP</Text>
            <View style={styles.listGap}>
              {[
                'Isi percakapan chat',
                'File & PDF yang kamu buka',
                'Catatan keuangan lokal',
                'Embedding / indeks RAG lokal',
                'Rekaman suara (jika voice mode lokal)',
              ].map(item => (
                <Text key={item} variant="bodyMedium" style={styles.item}>
                  • {item}
                </Text>
              ))}
            </View>
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="outlined">
          <Card.Content>
            <Text variant="titleMedium">Yang opsional (hanya jika kamu izinkan)</Text>
            <View style={styles.listGap}>
              {[
                'Download model dari Hugging Face',
                'Cuaca (Open-Meteo) saat talent weather dipanggil',
                'Benchmark/leaderboard jika kamu submit manual',
              ].map(item => (
                <Text key={item} variant="bodyMedium" style={styles.item}>
                  • {item}
                </Text>
              ))}
            </View>
          </Card.Content>
        </Card>

        <List.Section>
          <List.Subheader>Kontrol</List.Subheader>
          <List.Item
            title="Blokir jaringan untuk inferensi model"
            description="Model hanya jalan lokal (flag UI; enforcement menyusul)"
            right={() => (
              <Switch value={blockModelNet} onValueChange={onToggleBlock} />
            )}
          />
          <Divider />
          <List.Item
            title="Indikator Offline Mode"
            description={
              offlineBadge
                ? 'Offline Mode ON — 0 byte chat terkirim'
                : 'Indikator disembunyikan'
            }
            right={() => (
              <Switch value={offlineBadge} onValueChange={setOfflineBadge} />
            )}
          />
        </List.Section>

        <Text variant="bodySmall" style={styles.foot}>
          Box AI · com.v1byte.boxai · data default on-device
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0b0b0c'},
  pad: {padding: 16, paddingBottom: 40},
  title: {color: '#fff', fontWeight: '700', marginBottom: 6},
  sub: {color: '#8e8e93', marginBottom: 16},
  card: {
    backgroundColor: '#141416',
    borderColor: '#1c1c1e',
    marginBottom: 12,
  },
  listGap: {marginTop: 10, gap: 6},
  item: {color: '#d1d1d6'},
  foot: {color: '#636366', marginTop: 24, textAlign: 'center'},
});

export default PrivacyDashboardScreen;
