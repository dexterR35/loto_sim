# Loto 6/49 --- Statistical, Prediction, ML & Automatic Update Upgrade

## 1. Scop

Acest document definește un upgrade complet pentru aplicația existentă
**Loto 6/49 România**, folosind istoricul disponibil începând din 1993
și funcționalitățile deja existente (statistici, simulări, Monte Carlo,
scikit-learn / ML, blend-uri, LSTM și RAG/LLM).

Upgrade-ul este **strict pentru Loto 6/49**.

Obiectivele sunt:

1.  actualizarea automată a istoricului după fiecare extragere oficială;
2.  validarea statistică riguroasă a istoricului;
3.  analiza individuală a fiecărui număr 1--49;
4.  analiza relațiilor dintre numere;
5.  separarea clară între statistică descriptivă, inferență statistică
    și predicție;
6.  backtesting temporal real;
7.  integrarea și evaluarea algoritmilor existenți;
8.  introducerea unui pipeline ML reproductibil;
9.  antrenarea/recalibrarea automată după extrageri noi;
10. generarea unui ranking/scor predictiv pentru următoarea extragere;
11. păstrarea predicțiilor istorice pentru evaluare fără data leakage;
12. afișarea transparentă a motivelor pentru care un număr primește un
    anumit scor.

> Important: sistemul trebuie prezentat ca instrument statistic și
> experimental. O anomalie istorică sau un scor ML nu demonstrează că o
> extragere viitoare poate fi prezisă.

------------------------------------------------------------------------

# 2. Arhitectura recomandată

Pipeline-ul trebuie separat în module independente:

``` text
Official Loto Source
        |
        v
Scraper / Fetcher
        |
        v
Validation + Deduplication
        |
        v
Historical Dataset
        |
        +--------------------+
        |                    |
        v                    v
Statistical Engine      Feature Engine
        |                    |
        v                    v
Statistical Report      ML / LSTM / Blend
        |                    |
        +---------+----------+
                  |
                  v
          Prediction Engine
                  |
                  v
        Prediction Snapshot
                  |
                  v
              API / UI
```

Separarea este importantă pentru a evita ca logica de scraping,
statistica și predicția să devină dependente una de alta.

------------------------------------------------------------------------

# 3. Actualizarea automată a extragerilor

## 3.1 Cerință

Sistemul trebuie să poată prelua automat o extragere nouă de Loto 6/49
după publicarea rezultatului oficial.

Nu trebuie presupus că rezultatul este disponibil la o secundă/oră
exactă. Job-ul trebuie să verifice existența unei extrageri noi și să
suporte retry.

## 3.2 Flux

La fiecare rulare:

1.  accesează sursa oficială;
2.  identifică cea mai recentă extragere 6/49;
3.  extrage:
    -   data extragerii;
    -   cele 6 numere;
    -   eventual identificatorul extragerii dacă există;
    -   URL/sursa;
    -   timestamp-ul la care datele au fost preluate;
4.  validează că:
    -   sunt exact 6 numere;
    -   fiecare este între 1 și 49;
    -   numerele sunt distincte;
    -   data este validă;
5.  verifică dacă extragerea există deja;
6.  dacă este nouă, o persistă;
7.  rulează recalcularea statisticilor;
8.  evaluează predicția făcută înaintea acestei extrageri;
9.  actualizează dataset-ul ML;
10. rulează pipeline-ul de training/recalibrare conform politicii
    definite mai jos;
11. produce o predicție nouă pentru următoarea extragere;
12. salvează predicția ca snapshot imuabil.

## 3.3 Idempotency

Scraper-ul trebuie să poată fi rulat de mai multe ori fără a introduce
duplicate.

Cheie recomandată:

``` text
game + draw_date
```

sau un ID oficial, dacă sursa oferă unul stabil.

## 3.4 Retry

Dacă rezultatul nu este încă publicat:

-   nu se introduce un draw gol;
-   nu se modifică istoricul;
-   job-ul se termină controlat sau încearcă din nou ulterior;
-   eroarea trebuie logată.

## 3.5 GitHub Actions

Pentru o variantă gratuită, job-ul poate rula prin GitHub Actions.

Schedule-ul poate verifica în zilele de extragere, după intervalul
normal de publicare, eventual de mai multe ori la distanță de câteva
minute/zeci de minute.

**Nu hardcoda concluzia că rezultatul trebuie să existe la o anumită
oră.**

------------------------------------------------------------------------

# 4. Persistența datelor

Dacă aplicația folosește deja un istoric complet din 1993, acesta rămâne
sursa principală.

Pot fi folosite:

-   CSV/JSON pentru implementare simplă;
-   SQLite pentru local;
-   PostgreSQL pentru API, interogări și deployment mai complex.

Schema minimă:

``` text
draws
-----
id
game
draw_date
n1
n2
n3
n4
n5
n6
source
source_hash
fetched_at
created_at
```

Este recomandată și o reprezentare normalizată:

``` text
draw_numbers
------------
draw_id
number
```

Aceasta simplifică statisticile SQL.

------------------------------------------------------------------------

# 5. Cele trei niveluri ale analizei

Aplicația trebuie să facă diferența explicit între:

## 5.1 Statistică descriptivă

Răspunde la:

> Ce s-a întâmplat în trecut?

Exemple:

-   frecvențe;
-   gap-uri;
-   hot/cold;
-   perechi;
-   triple;
-   sumă;
-   par/impar;
-   low/high;
-   distribuții;
-   recency.

## 5.2 Inferență statistică

Răspunde la:

> Este abaterea observată suficient de mare încât să fie interesantă
> statistic?

Exemple:

-   chi-square;
-   p-value;
-   confidence intervals;
-   Monte Carlo;
-   multiple-testing correction;
-   drift temporal.

## 5.3 Predicție

Răspunde la:

> Informația disponibilă înainte de o extragere îmbunătățește
> rezultatele out-of-sample?

Aceasta trebuie evaluată exclusiv prin backtesting temporal.

------------------------------------------------------------------------

# 6. Observat vs. așteptat

Pentru fiecare număr `1..49` trebuie calculat:

-   **observed** --- de câte ori a apărut efectiv;
-   **expected** --- de câte ori ar fi fost așteptat într-un proces
    uniform;
-   **difference** --- `observed - expected`;
-   **deviation_pct**;
-   \*\*standardized residual / z-like score\`;
-   **chi-square contribution**;
-   confidence interval;
-   p-value unde este statistic justificat;
-   adjusted p-value;
-   flag/watch status.

Pentru `N` extrageri 6/49:

``` text
P(un număr apare într-o extragere) = 6 / 49
Expected = N * 6 / 49
```

Nu se presupune independență între cele șase poziții din aceeași
extragere; selecția este fără înlocuire.

------------------------------------------------------------------------

# 7. Test chi-square global

Se implementează un test global asupra frecvențelor numerelor.

Scop:

-   verificarea compatibilității distribuției observate cu distribuția
    uniformă;
-   identificarea numerelor cu contribuții mari la statistica globală.

Pentru fiecare număr:

``` text
contribution_i = (observed_i - expected_i)^2 / expected_i
```

UI-ul trebuie să afișeze contribuția individuală, dar verdictul
principal trebuie să rămână **global**.

Nu trebuie interpretate automat 49 de teste individuale drept 49 de
dovezi separate.

------------------------------------------------------------------------

# 8. Multiple testing

Pentru analize individuale, perechi, triple, ferestre temporale etc.
apar foarte multe comparații.

Trebuie implementată cel puțin una dintre:

-   Benjamini-Hochberg / FDR;
-   Holm;
-   Bonferroni pentru teste unde este justificat.

Raportul trebuie să păstreze:

``` text
raw_p_value
adjusted_p_value
significant_raw
significant_adjusted
```

Interfața trebuie să favorizeze `adjusted_p_value`.

------------------------------------------------------------------------

# 9. Analiza pe fiecare număr

Fiecare număr 1--49 trebuie să aibă o pagină/panel detaliat.

La click pe un număr se afișează:

## Overview

-   număr;
-   apariții totale;
-   expected;
-   observed;
-   diferență;
-   deviation %;
-   rank de frecvență;
-   rank predictiv curent;
-   probabilitate/scor ML calibrat;
-   confidence / uncertainty.

## Recency

-   ultima apariție;
-   current gap;
-   average gap;
-   median gap;
-   max gap;
-   percentile current gap;
-   overdue score.

## Ferestre

Statisticile pentru:

-   ultimele 10;
-   25;
-   50;
-   100;
-   250;
-   500 extrageri;
-   1 an;
-   3 ani;
-   5 ani;
-   full history.

## Trend

-   frecvență rolling;
-   deviation rolling;
-   EWMA;
-   trend recent vs long-term;
-   drift score.

## Relații

-   cele mai frecvente perechi cu acel număr;
-   perechi observate vs expected;
-   lift;
-   z-score / Monte Carlo percentile;
-   adjusted significance;
-   cele mai relevante triple, dacă sunt statistic gestionabile.

## Model contribution

Pentru fiecare model:

-   scor;
-   rank;
-   feature contribution dacă poate fi explicată;
-   contribuția la blend;
-   versiunea modelului.

------------------------------------------------------------------------

# 10. Analiza perechilor

Există:

``` text
C(49, 2) = 1176
```

perechi posibile.

Pentru fiecare pereche:

-   observed count;
-   expected count;
-   deviation;
-   lift;
-   recency;
-   average gap;
-   Monte Carlo percentile;
-   raw p-value;
-   adjusted p-value.

Probabilitatea teoretică a unei perechi specifice într-o extragere 6/49
trebuie calculată combinatorial, nu prin presupunerea greșită de
independență a numerelor.

------------------------------------------------------------------------

# 11. Triple și combinații de ordin superior

Triplele pot fi analizate, dar trebuie tratate atent din cauza
sparsității.

Pentru triple:

-   count;
-   expected;
-   lift;
-   Monte Carlo percentile;
-   minimum support;
-   FDR correction.

Nu se recomandă folosirea brută a tuturor combinațiilor de ordin mare ca
features.

Se aplică:

-   minimum support;
-   shrinkage;
-   regularizare;
-   selecție de features.

------------------------------------------------------------------------

# 12. Gap / recency analysis

Pentru fiecare număr:

``` text
current_gap
mean_gap
median_gap
std_gap
max_gap
gap_percentile
```

Se testează dacă distribuția gap-urilor este compatibilă cu procesul
așteptat.

**Un gap mare nu înseamnă că numărul „trebuie" să apară.**

Overdue trebuie tratat ca feature experimental, nu ca regulă matematică.

------------------------------------------------------------------------

# 13. Hot / Cold

Păstrează hot/cold ca analiză descriptivă.

Calculează separat:

-   short-term hotness;
-   medium-term;
-   long-term;
-   normalized hotness;
-   coldness;
-   trend.

Exemplu:

``` text
hot_25
hot_50
hot_100
hot_250
long_term_frequency
```

Modelele pot decide dacă aceste features au valoare out-of-sample.

------------------------------------------------------------------------

# 14. Drift temporal

Testează dacă frecvențele sau relațiile se schimbă între perioade.

Exemple:

``` text
1993–2000
2001–2010
2011–2020
2021–present
```

și ferestre rolling.

Analize:

-   chi-square între perioade;
-   Jensen-Shannon divergence;
-   PSI;
-   rolling frequency deviation;
-   change-point detection opțional.

Un drift trebuie confirmat în mai multe ferestre înainte de a fi
considerat feature relevant.

------------------------------------------------------------------------

# 15. Monte Carlo

Monte Carlo trebuie să aibă două roluri distincte.

## 15.1 Null simulation

Generează istorice sintetice compatibile cu regulile 6/49.

Pentru fiecare istoric simulat se recalculează aceleași statistici ca în
istoricul real.

Se estimează:

``` text
percentile_real
empirical_p_value
z_score_vs_simulation
```

Astfel se poate răspunde:

> Cât de des apare o abatere cel puțin la fel de mare într-un istoric
> pur aleator?

## 15.2 Ticket simulation

Simulatorul existent pentru generarea/evaluarea biletelor trebuie
păstrat separat de null simulation.

Nu amesteca:

-   Monte Carlo pentru testarea ipotezei;
-   Monte Carlo pentru generarea combinațiilor.

------------------------------------------------------------------------

# 16. Reproductibilitate Monte Carlo

Toate simulările trebuie să suporte:

``` python
random_seed
n_simulations
simulation_version
```

Rezultatele trebuie să poată fi reproduse.

Pentru rapoarte importante, salvează seed-ul.

------------------------------------------------------------------------

# 17. Feature engineering

Pentru fiecare extragere `t`, features trebuie construite folosind
**exclusiv extragerile \< t**.

Exemple pentru fiecare număr:

``` text
freq_full
freq_10
freq_25
freq_50
freq_100
freq_250
gap_current
gap_mean
gap_percentile
hot_score
cold_score
trend_score
pair_strength
pair_recent_strength
monte_carlo_percentile
chi_contribution_history
drift_score
ewma_frequency
```

Features globale:

``` text
draw_count_history
rolling_entropy
frequency_dispersion
pair_dispersion
recent_vs_long_term_divergence
```

------------------------------------------------------------------------

# 18. Data leakage --- regulă obligatorie

Pentru a prezice extragerea `t`:

``` text
features(t) = information available before t
target(t)   = actual draw at t
```

Nicio statistică ce include extragerea `t` sau viitorul nu poate intra
în features.

Această regulă trebuie testată automat.

------------------------------------------------------------------------

# 19. Reprezentarea target-ului ML

O extragere poate fi reprezentată ca vector multi-label de 49 poziții:

``` text
[0, 1, 0, ..., 1]
```

cu exact șase valori `1`.

Modelul produce câte un scor pentru fiecare număr:

``` text
score[1..49]
```

Aceste scoruri sunt ranking scores / probabilități modelate, nu
garanții.

------------------------------------------------------------------------

# 20. Baseline-uri obligatorii

Orice model trebuie comparat cu:

1.  random uniform;
2.  frequency-only;
3.  recent-frequency;
4.  hot;
5.  cold;
6.  overdue;
7.  balanced heuristic;
8.  Monte Carlo strategy existentă.

Un model complex nu este acceptat automat doar fiindcă are metrici bune
in-sample.

------------------------------------------------------------------------

# 21. Backtesting walk-forward

Implementarea trebuie să suporte walk-forward / expanding-window.

Exemplu:

``` text
Train: 1993–2018 -> Test: 2019
Train: 1993–2019 -> Test: 2020
Train: 1993–2020 -> Test: 2021
Train: 1993–2021 -> Test: 2022
...
```

Alternativ, evaluare draw-by-draw:

``` text
train on all draws before t
predict t
record result
advance one draw
```

Aceasta este evaluarea preferată pentru pipeline-ul final.

------------------------------------------------------------------------

# 22. Predicțiile trebuie salvate înainte de rezultat

Pentru fiecare predicție:

``` text
prediction_id
target_draw_date
created_at
model_version
dataset_version
feature_version
seed
scores_1_49
ranking_1_49
recommended_sets
config
```

Snapshot-ul devine read-only.

După extragere se atașează rezultatul real, fără a modifica predicția
originală.

------------------------------------------------------------------------

# 23. Metrici predictive

Nu evalua doar „a prins sau nu 6 numere".

Folosește:

## Ranking

-   Precision@6;
-   Recall@6;
-   Hits@6;
-   Precision@10;
-   Recall@10;
-   Mean Reciprocal Rank unde este relevant;
-   NDCG@k;
-   average rank of winning numbers.

## Probabilistic

-   Brier score;
-   log loss adaptat reprezentării;
-   calibration error;
-   reliability/calibration curves.

## Ticket-level

Distribuția:

``` text
0 hits
1 hit
2 hits
3 hits
4 hits
5 hits
6 hits
```

comparată cu baseline-ul random.

------------------------------------------------------------------------

# 24. Evaluarea față de random

Nu este suficient:

``` text
model_hits > random_hits
```

Trebuie comparată distribuția performanței cu multe baseline-uri random.

Exemplu:

``` text
10,000 random strategies
```

Calculează:

-   percentile;
-   empirical p-value;
-   confidence interval;
-   effect size.

Un avantaj trebuie să fie:

-   out-of-sample;
-   repetabil;
-   stabil în mai multe perioade;
-   suficient de mare încât să nu fie doar variație aleatorie.

------------------------------------------------------------------------

# 25. scikit-learn

Modele recomandate ca benchmark:

-   Logistic Regression;
-   Random Forest;
-   Extra Trees;
-   Gradient Boosting;
-   HistGradientBoosting;
-   XGBoost/LightGBM doar dacă sunt deja permise ca dependențe;
-   calibrated classifiers.

Pentru 49 de targets poate fi folosit:

-   one-vs-rest;
-   multi-output;
-   modele separate per număr.

Începe cu modele simple ca baseline înaintea modelelor neurale.

------------------------------------------------------------------------

# 26. PyTorch

PyTorch poate fi introdus pentru modele experimentale.

Arhitectură inițială:

``` text
Feature vector
 -> Linear
 -> ReLU
 -> Dropout
 -> Linear
 -> ReLU
 -> Linear(49)
 -> sigmoid scores
```

Loss posibil:

``` text
BCEWithLogitsLoss
```

Dar trebuie ținut cont de constrângerea că exact șase numere sunt
extrase.

Modelul trebuie evaluat în primul rând ca **ranker**.

------------------------------------------------------------------------

# 27. LSTM existent

LSTM-ul existent trebuie auditat pentru:

-   ordinea temporală;
-   window construction;
-   leakage;
-   normalization fit doar pe train;
-   hidden-state handling;
-   target alignment;
-   random seed;
-   reproducibilitate.

Testează mai multe lungimi:

``` text
10
25
50
100
```

Nu presupune că o secvență mai lungă este automat mai bună.

LSTM-ul trebuie comparat direct cu modelele tabulare simple.

------------------------------------------------------------------------

# 28. Modele secvențiale suplimentare

Opțional:

-   GRU;
-   Temporal CNN;
-   Transformer mic;
-   MLP pe rolling features.

Nu introduce modele mari doar pentru complexitate.

Dataset-ul este relativ mic pentru deep learning, deci regularizarea și
validarea temporală sunt critice.

------------------------------------------------------------------------

# 29. Hugging Face

Hugging Face nu trebuie să fie componentă obligatorie pentru predicția
numerică.

Poate fi folosit pentru:

-   management/versionare modele;
-   experiment tracking dacă infrastructura o justifică;
-   eventual interfață LLM separată.

Nu este necesar un LLM pentru a calcula predicțiile numerice.

------------------------------------------------------------------------

# 30. Ensemble / Blend

Dacă există deja blend, formalizează-l.

Fiecare model produce:

``` text
normalized_score[1..49]
```

Blend:

``` text
final_score_i =
    w_stat * stat_score_i +
    w_sklearn * sklearn_score_i +
    w_lstm * lstm_score_i +
    w_mc * monte_carlo_score_i +
    ...
```

Ponderile nu trebuie alese după impresie.

Ele se optimizează numai pe train/validation istoric și se verifică pe
perioade out-of-sample.

------------------------------------------------------------------------

# 31. Dynamic ensemble

Opțional, ponderile pot fi dependente de performanța recentă.

Exemplu:

``` text
weight(model) ∝ rolling_out_of_sample_score(model)
```

Dar trebuie:

-   smoothing;
-   minimum history;
-   caps;
-   protecție împotriva overfitting-ului.

------------------------------------------------------------------------

# 32. Training continuu după fiecare extragere

După o extragere nouă:

1.  se încarcă predicția snapshot făcută înainte;
2.  se evaluează contra rezultatului;
3.  se salvează metricile;
4.  se adaugă noul draw în istoricul validat;
5.  se recalculează features;
6.  se actualizează dataset-ul de training;
7.  se poate antrena un **candidate model**;
8.  candidate-ul se validează walk-forward;
9.  se compară cu modelul production;
10. se promovează doar dacă trece criteriile.

Nu înlocui automat modelul production după fiecare draw doar fiindcă a
fost reantrenat.

------------------------------------------------------------------------

# 33. Model registry

Pentru fiecare model:

``` text
model_id
model_type
created_at
training_end_date
dataset_hash
feature_version
hyperparameters
seed
validation_metrics
backtest_metrics
status
```

Status:

``` text
candidate
production
rejected
archived
```

------------------------------------------------------------------------

# 34. Champion / Challenger

Folosește:

-   **Champion** = modelul activ;
-   **Challenger** = model nou.

Challenger-ul devine Champion numai dacă:

-   nu are leakage;
-   trece testele;
-   are performanță out-of-sample mai bună;
-   avantajul nu este concentrat într-o singură perioadă;
-   calibrarea nu se degradează sever.

------------------------------------------------------------------------

# 35. Predicția următoarei extrageri

Output-ul principal nu trebuie să fie doar „șase numere magice".

Trebuie produs:

``` text
rank | number | final_score | confidence | main_factors
```

pentru toate cele 49 de numere.

Apoi UI-ul poate afișa:

-   Top 6;
-   Top 10;
-   Top 15;
-   scorul fiecărui număr;
-   contribuțiile modelelor.

------------------------------------------------------------------------

# 36. Explicabilitate

Pentru fiecare număr, afișează motivele scorului.

Exemplu:

``` text
Number 17
Final rank: 4
Statistical score: 0.61
ML score: 0.68
LSTM score: 0.54
Monte Carlo score: 0.59

Main positive factors:
+ recent frequency
+ pair strength with 8
+ model ensemble consensus

Negative factors:
- weak long-term deviation
- unstable rolling signal
```

Nu transforma aceste explicații în afirmații cauzale.

------------------------------------------------------------------------

# 37. UI --- Number Explorer

Când utilizatorul dă click pe un număr, deschide un drawer/modal/page
cu:

### Header

-   Number;
-   Current Prediction Rank;
-   Final Score;
-   Statistical Status.

### Observed vs Expected

-   observed;
-   expected;
-   delta;
-   delta %;
-   contribution;
-   p-value;
-   adjusted p-value.

### Frequency

-   full;
-   rolling windows;
-   trend chart.

### Gap

-   current;
-   average;
-   median;
-   percentile.

### Relationships

-   top pairs;
-   pair lift;
-   pair significance;
-   recent pair activity.

### Models

-   sklearn score;
-   LSTM score;
-   PyTorch score;
-   Monte Carlo score;
-   blend contribution.

### History

-   toate extragerile în care a apărut;
-   timeline;
-   intervale între apariții.

------------------------------------------------------------------------

# 38. Dashboard statistic

Dashboard-ul principal trebuie să includă:

-   total draws;
-   last draw;
-   next scheduled update;
-   chi-square global;
-   global p-value;
-   entropy;
-   top observed deviations;
-   top pair deviations;
-   drift status;
-   Monte Carlo null percentile;
-   model version;
-   last training date;
-   current prediction.

------------------------------------------------------------------------

# 39. Thresholds / praguri

Pragurile trebuie configurabile.

Exemplu:

``` yaml
statistics:
  alpha: 0.05
  fdr_alpha: 0.05
  min_pair_support: 5
  monte_carlo_runs: 10000
```

UI:

``` text
neutral
watch
statistically_interesting
unstable
```

Evită etichete precum:

``` text
guaranteed
certain
must_draw
```

------------------------------------------------------------------------

# 40. Confidence și uncertainty

Orice predicție trebuie să includă incertitudine.

Dacă modelele nu sunt de acord:

``` text
ensemble_disagreement = high
```

Dacă toate modelele dau scoruri apropiate:

``` text
prediction_confidence = low
```

Confidence-ul trebuie să descrie stabilitatea modelului, nu
probabilitatea că biletul va câștiga.

------------------------------------------------------------------------

# 41. API

Endpoint-uri recomandate:

``` text
GET /api/649/latest
GET /api/649/history
GET /api/649/statistics
GET /api/649/statistics/numbers
GET /api/649/statistics/numbers/{number}
GET /api/649/statistics/pairs
GET /api/649/statistics/tests
GET /api/649/prediction/latest
GET /api/649/predictions/history
GET /api/649/models
GET /api/649/backtest
```

Endpoint intern/admin:

``` text
POST /api/649/update
POST /api/649/train
POST /api/649/backtest
```

Dacă acestea sunt publice, protejează endpoint-urile care declanșează
job-uri costisitoare.

------------------------------------------------------------------------

# 42. Exemplu output pentru un număr

``` json
{
  "number": 17,
  "observed": 512,
  "expected": 498.7,
  "deviation": 13.3,
  "deviation_pct": 2.67,
  "chi_contribution": 0.355,
  "raw_p_value": 0.18,
  "adjusted_p_value": 0.62,
  "current_gap": 7,
  "gap_percentile": 0.71,
  "frequency_rank": 9,
  "prediction_rank": 4,
  "scores": {
    "statistics": 0.61,
    "sklearn": 0.68,
    "lstm": 0.54,
    "pytorch": 0.63,
    "monte_carlo": 0.59,
    "blend": 0.64
  },
  "status": "watch"
}
```

Valorile de mai sus sunt doar exemplificative.

------------------------------------------------------------------------

# 43. Statistical report

Fiecare recalculare poate produce un raport versionat:

``` text
reports/
  statistical/
    2026-08-09.json
```

Conținut:

``` text
dataset_version
draw_count
date_range
global_tests
number_tests
pair_tests
gap_tests
drift_tests
monte_carlo_tests
warnings
```

------------------------------------------------------------------------

# 44. Prediction report

``` text
reports/
  predictions/
    <target_draw_date>.json
```

Conține:

-   timestamp;
-   model versions;
-   feature version;
-   ranking complet 1--49;
-   top recommendations;
-   uncertainty;
-   explanations.

După extragere:

``` text
evaluation
actual_numbers
hits_at_6
hits_at_10
rank_of_actual_numbers
model_metrics
```

Predicția inițială rămâne nemodificată.

------------------------------------------------------------------------

# 45. Eșantionare și subset-uri

Analizele trebuie făcute pe:

-   full history;
-   expanding windows;
-   rolling windows;
-   perioade calendaristice;
-   train/validation/test temporale.

Nu folosi split random pentru evaluarea finală a unui model temporal.

Random split poate fi folosit doar pentru experimente auxiliare unde
ordinea temporală nu influențează concluzia.

------------------------------------------------------------------------

# 46. Bootstrap

Pentru metrici și diferențe între modele poate fi folosit bootstrap
temporal/block bootstrap.

Scop:

-   confidence intervals;
-   stabilitatea metricilor;
-   comparația modelelor.

Evita bootstrap-ul naiv dacă distruge complet structura temporală
analizată.

------------------------------------------------------------------------

# 47. Ablation tests

Pentru a afla ce ajută cu adevărat:

``` text
Model A: frequency only
Model B: + gaps
Model C: + pairs
Model D: + Monte Carlo features
Model E: + drift
Model F: full model
```

Compară performanța walk-forward.

Dacă o familie de features nu ajută, elimin-o.

------------------------------------------------------------------------

# 48. Feature importance

Pentru modelele compatibile:

-   permutation importance;
-   SHAP opțional;
-   coefficients;
-   gain importance.

Feature importance se calculează pe validation/test, nu doar train.

------------------------------------------------------------------------

# 49. Hyperparameter tuning

Dacă se face tuning:

-   nu folosi viitorul;
-   folosește TimeSeriesSplit sau custom walk-forward;
-   salvează search space;
-   salvează seed;
-   salvează best params.

Nu optimiza direct pe test-ul final.

------------------------------------------------------------------------

# 50. Experiment tracking

Pentru fiecare experiment:

``` text
experiment_id
git_commit
dataset_hash
feature_version
model_type
hyperparameters
seed
train_range
validation_range
test_range
metrics
notes
```

Poate fi implementat simplu în JSON/SQLite înainte de introducerea unui
framework complex.

------------------------------------------------------------------------

# 51. Teste automate

## Scraper

-   parse successful;
-   invalid HTML;
-   missing result;
-   duplicate draw;
-   malformed numbers;
-   timeout;
-   changed selector.

## Statistics

-   expected frequency;
-   chi contribution;
-   pair expected probability;
-   gap calculations;
-   multiple-test correction.

## ML

-   no future rows in features;
-   chronological split;
-   deterministic seed;
-   correct target alignment;
-   prediction contains 49 scores;
-   snapshot created before evaluation.

## API

-   valid number 1--49;
-   invalid number;
-   latest draw;
-   prediction schema.

------------------------------------------------------------------------

# 52. Monitoring

Loghează:

``` text
scrape_success
scrape_failure
new_draw_detected
duplicate_draw
statistics_rebuilt
training_started
training_completed
candidate_rejected
candidate_promoted
prediction_created
prediction_evaluated
```

------------------------------------------------------------------------

# 53. Protecție la schimbarea site-ului sursă

Scraper-ul trebuie izolat într-un adapter.

Exemplu:

``` python
class LotoSource:
    def fetch_latest_649(self):
        ...
```

Restul aplicației nu trebuie să știe selectoarele HTML.

Dacă site-ul se schimbă, se modifică doar adapter-ul.

------------------------------------------------------------------------

# 54. Cache

API-ul nu trebuie să scrape-uiască site-ul oficial la fiecare request.

Flux corect:

``` text
scheduled scraper
 -> local persistent data
 -> recalculation
 -> API reads cached/persisted results
```

Acest lucru reduce dependența runtime de site-ul extern.

------------------------------------------------------------------------

# 55. Model training policy

Config exemplu:

``` yaml
training:
  retrain_after_new_draw: true
  minimum_new_draws_for_full_retrain: 1
  promotion_requires_backtest: true
  keep_previous_champion: true
  seed: 42
```

Chiar dacă se antrenează după fiecare draw, promovarea trebuie să rămână
condiționată de validare.

------------------------------------------------------------------------

# 56. Prediction generation policy

După actualizare:

``` text
new draw
 -> evaluate previous prediction
 -> update history
 -> rebuild statistics/features
 -> train/recalibrate candidate
 -> validate candidate
 -> choose production model
 -> generate next prediction
 -> freeze prediction snapshot
```

------------------------------------------------------------------------

# 57. Simulator

Simulatorul trebuie să poată folosi:

-   random;
-   weighted random;
-   statistics score;
-   sklearn;
-   LSTM;
-   PyTorch;
-   blend.

Pentru fiecare strategie, salvează configurația și seed-ul.

------------------------------------------------------------------------

# 58. Generarea biletelor din scoruri

Nu lua obligatoriu primele șase numere.

Permite strategii:

### Top-6

Primele șase după scor.

### Weighted Sampling

Sampling fără înlocuire folosind scorurile normalizate.

### Diversified

Generează mai multe bilete cu penalizare pentru overlap.

### Constraints

Opțional:

-   par/impar;
-   low/high;
-   sum range;
-   maximum consecutive;
-   overlap control.

Aceste constrângeri trebuie evaluate prin backtest, nu presupuse utile.

------------------------------------------------------------------------

# 59. RAG / LLM

LLM-ul trebuie să fie strat explicativ, nu motorul matematic principal.

Poate răspunde la:

-   „De ce e 17 pe locul 4?"
-   „Cum s-a schimbat frecvența lui 32?"
-   „Care model a contribuit cel mai mult?"
-   „Cum s-a comportat LSTM în ultimul backtest?"

RAG-ul poate primi:

-   statistical reports;
-   prediction reports;
-   model registry;
-   backtest summaries.

LLM-ul nu trebuie să inventeze statistici. Valorile trebuie luate din
output-urile calculate.

------------------------------------------------------------------------

# 60. Contribuții / decomposition

Pentru fiecare număr trebuie să poată fi explicat scorul final:

``` text
statistical contribution
frequency contribution
recency contribution
pair contribution
ML contribution
LSTM contribution
PyTorch contribution
Monte Carlo contribution
ensemble weight
```

Dacă modelul nu oferă explicație exactă, UI-ul trebuie să marcheze
contribuția ca aproximativă.

------------------------------------------------------------------------

# 61. Compararea „observat A" vs „observat B"

Sistemul trebuie să permită compararea a două perioade.

Exemplu:

``` text
A = 1993–2009
B = 2010–present
```

Pentru fiecare număr:

``` text
observed_A
expected_A
rate_A
observed_B
expected_B
rate_B
delta_rate
statistical_test
p_value
adjusted_p_value
```

Aceeași funcție trebuie să poată compara:

-   decade;
-   year;
-   rolling windows;
-   pre/post date;
-   first half vs second half.

------------------------------------------------------------------------

# 62. „Sub prag" și „peste prag"

Nu reduce rezultatul doar la p-value.

Pentru fiecare semnal:

``` text
effect_size
raw_p
adjusted_p
stability
sample_size
monte_carlo_percentile
```

Clasificare posibilă:

``` text
neutral
weak_signal
watch
statistically_interesting
unstable
```

„Peste prag" nu înseamnă „va ieși".

------------------------------------------------------------------------

# 63. Validarea ipotezei de non-randomness

Dacă proiectul investighează ipoteza că extragerile ar putea conține
bias, testarea trebuie făcută explicit.

Null hypothesis:

``` text
H0: extragerile sunt compatibile cu mecanismul uniform 6/49
```

Alternative:

``` text
H1: există abateri măsurabile față de H0
```

Se verifică:

-   marginal frequencies;
-   pairs;
-   gaps;
-   temporal drift;
-   distribution of sums;
-   parity;
-   low/high;
-   consecutive numbers;
-   entropy;
-   autocorrelation unde are sens.

Rezultatul trebuie să distingă:

``` text
evidence against H0
```

de:

``` text
predictive advantage
```

Acestea NU sunt același lucru.

------------------------------------------------------------------------

# 64. Autocorrelation / dependence

Testează dacă apariția unui număr la `t` are relație cu:

``` text
t-1
t-2
...
```

Folosește:

-   lagged correlations;
-   conditional occurrence rates;
-   permutation/Monte Carlo null;
-   multiple-testing correction.

Nu interpreta corelații mici fără intervale de încredere.

------------------------------------------------------------------------

# 65. Entropy

Calculează:

-   marginal entropy;
-   rolling entropy;
-   entropy of pair distribution;
-   divergence from simulated histories.

Folosește Monte Carlo pentru a determina dacă valorile reale sunt
neobișnuite.

------------------------------------------------------------------------

# 66. Sum / parity / ranges

Pentru fiecare draw:

-   sum;
-   odd/even count;
-   low/high count;
-   spread;
-   min/max;
-   range;
-   consecutive count.

Compară distribuțiile reale cu distribuțiile teoretice sau simulate.

Aceste features pot intra în simulator, dar valoarea predictivă trebuie
demonstrată separat.

------------------------------------------------------------------------

# 67. Calibration

Dacă modelul produce probabilități, verifică dacă sunt calibrate.

Exemplu:

Numerele cărora modelul le acordă scoruri mai mari trebuie să aibă rate
observate corespunzătoare în evaluarea out-of-sample.

Folosește:

-   calibration curve;
-   Brier score;
-   isotonic;
-   Platt/sigmoid calibration unde este potrivit.

------------------------------------------------------------------------

# 68. Reproducibilitate generală

Orice rezultat important trebuie să poată fi refăcut din:

``` text
git commit
dataset hash
config
seed
model version
feature version
```

------------------------------------------------------------------------

# 69. Config central

Recomandare:

``` yaml
game:
  name: "6/49"
  numbers: 49
  draw_size: 6

statistics:
  alpha: 0.05
  fdr_alpha: 0.05
  monte_carlo_runs: 10000
  rolling_windows: [10, 25, 50, 100, 250, 500]

ml:
  enabled: true
  walk_forward: true
  random_seed: 42

training:
  retrain_after_new_draw: true
  champion_challenger: true

prediction:
  top_k: [6, 10, 15]
  save_snapshot: true
```

------------------------------------------------------------------------

# 70. Structură de module propusă

Adaptează numele la structura reală a repo-ului; nu rescrie inutil
componentele existente.

``` text
loto649/
  data/
    scraper.py
    validator.py
    repository.py

  statistics/
    frequencies.py
    expected.py
    chi_square.py
    pairs.py
    gaps.py
    drift.py
    monte_carlo.py
    multiple_testing.py
    entropy.py
    report.py

  features/
    builder.py
    temporal.py
    pair_features.py

  models/
    baselines.py
    sklearn_models.py
    lstm.py
    pytorch_model.py
    ensemble.py
    registry.py

  evaluation/
    walk_forward.py
    metrics.py
    random_baseline.py
    ablation.py

  prediction/
    service.py
    snapshot.py
    ticket_generator.py

  api/
    routes.py
```

Dacă repo-ul are deja o arhitectură diferită, **integrează în
arhitectura existentă** în loc să creezi un al doilea sistem paralel.

------------------------------------------------------------------------

# 71. Pseudocod --- statistical engine

``` python
def build_statistical_report(draws):
    validate_draws(draws)

    frequencies = calculate_frequencies(draws)
    expected = calculate_expected_frequencies(draws)

    chi = chi_square_global(
        observed=frequencies,
        expected=expected,
    )

    number_details = calculate_number_statistics(
        draws=draws,
        frequencies=frequencies,
        expected=expected,
    )

    pairs = analyze_pairs(draws)
    gaps = analyze_gaps(draws)
    drift = analyze_temporal_drift(draws)

    monte_carlo = run_null_simulation(
        draws_count=len(draws),
        real_statistics={
            "frequencies": frequencies,
            "pairs": pairs,
            "gaps": gaps,
        },
    )

    corrected = apply_multiple_testing(
        number_details,
        pairs,
    )

    return {
        "global": chi,
        "numbers": corrected["numbers"],
        "pairs": corrected["pairs"],
        "gaps": gaps,
        "drift": drift,
        "monte_carlo": monte_carlo,
    }
```

------------------------------------------------------------------------

# 72. Pseudocod --- feature builder

``` python
def build_features_for_target(draws, target_index):
    history = draws[:target_index]

    assert len(history) > 0

    return {
        "frequency": build_frequency_features(history),
        "recency": build_recency_features(history),
        "pairs": build_pair_features(history),
        "drift": build_drift_features(history),
        "monte_carlo": build_mc_features(history),
    }
```

**Nu utiliza `draws[target_index]` în features.**

------------------------------------------------------------------------

# 73. Pseudocod --- walk-forward

``` python
predictions = []

for target_index in range(MIN_HISTORY, len(draws)):
    train_draws = draws[:target_index]
    actual = draws[target_index]

    dataset = build_training_dataset(train_draws)
    model = train_model(dataset)

    features = build_features_for_next_draw(train_draws)
    scores = model.predict(features)

    predictions.append(
        evaluate_prediction(scores, actual)
    )

report = aggregate_metrics(predictions)
```

Pentru performanță, modelele nu trebuie neapărat reantrenate complet la
fiecare iterație dacă evaluarea păstrează corectitudinea temporală.

------------------------------------------------------------------------

# 74. Pseudocod --- update automat

``` python
def update_pipeline():
    latest = source.fetch_latest_649()

    validate_draw(latest)

    if repository.exists(latest.draw_date):
        return {"status": "already_up_to_date"}

    previous_prediction = predictions.get_for_draw(latest.draw_date)

    if previous_prediction:
        evaluation = evaluate(
            previous_prediction,
            latest,
        )
        evaluations.save(evaluation)

    repository.insert(latest)

    statistical_report = statistics.rebuild()
    features.rebuild()

    candidate = training.train_candidate()
    validation = backtest.evaluate(candidate)

    if promotion_policy.accept(candidate, validation):
        registry.promote(candidate)

    next_prediction = prediction.generate()
    predictions.freeze(next_prediction)

    return {"status": "updated"}
```

------------------------------------------------------------------------

# 75. Acceptance criteria

Upgrade-ul este considerat implementat când:

-   [ ] scraper-ul preia extrageri noi 6/49;
-   [ ] nu creează duplicate;
-   [ ] statisticile se actualizează automat;
-   [ ] fiecare număr 1--49 are detail view;
-   [ ] observed vs expected este disponibil;
-   [ ] chi-square global este implementat;
-   [ ] contribuția fiecărui număr este disponibilă;
-   [ ] multiple-testing correction este implementată;
-   [ ] perechile sunt analizate;
-   [ ] gap/recency este analizat;
-   [ ] Monte Carlo null simulation este separat de ticket simulation;
-   [ ] drift temporal este disponibil;
-   [ ] features nu conțin viitor;
-   [ ] walk-forward backtest există;
-   [ ] random baseline există;
-   [ ] modelele existente sunt comparate în aceeași infrastructură;
-   [ ] LSTM-ul este auditat pentru leakage;
-   [ ] PyTorch poate fi activat ca model experimental;
-   [ ] blend-ul este formalizat;
-   [ ] prediction snapshots sunt imuabile;
-   [ ] predicția anterioară este evaluată automat după draw;
-   [ ] training/recalibrarea poate rula automat;
-   [ ] există Champion/Challenger;
-   [ ] există ranking 1--49;
-   [ ] UI-ul explică scorul fiecărui număr;
-   [ ] API-ul expune statistici și predicții;
-   [ ] testele automate sunt verzi;
-   [ ] rapoartele sunt reproductibile.

------------------------------------------------------------------------

# 76. Instrucțiuni pentru agentul care implementează

1.  **Inspectează mai întâi repo-ul existent.**
2.  Nu elimina funcționalitățile existente.
3.  Identifică implementările actuale pentru:
    -   Monte Carlo;
    -   scikit-learn;
    -   blend;
    -   LSTM;
    -   statistics;
    -   simulator;
    -   history loader;
    -   API/UI.
4.  Refolosește codul bun existent.
5.  Refactorizează doar unde este necesar pentru separarea
    responsabilităților.
6.  Adaugă teste înainte/odată cu modificările critice.
7.  Nu modifica istoricul valid fără migrare explicită.
8.  Nu introduce data leakage.
9.  Nu declara un model „mai bun" fără walk-forward comparison.
10. Nu interpreta p-value drept probabilitate de câștig.
11. Păstrează scope-ul exclusiv la **Loto 6/49 România** pentru acest
    upgrade.
12. Scraper-ul trebuie să fie adapter separat.
13. Pipeline-ul trebuie să poată fi rulat local și automatizat.
14. Orice predicție trebuie salvată înainte de extragerea țintă.
15. La final, produce un raport cu:
    -   fișiere create/modificate;
    -   teste;
    -   rezultate backtest;
    -   modele comparate;
    -   eventuale limitări.

------------------------------------------------------------------------

# 77. Ordinea recomandată de implementare

## Phase 1 --- Data

-   scraper;
-   validator;
-   dedup;
-   automatic update;
-   tests.

## Phase 2 --- Statistical Engine

-   observed/expected;
-   chi-square;
-   number details;
-   pairs;
-   gaps;
-   multiple testing;
-   Monte Carlo null;
-   drift.

## Phase 3 --- Backtesting

-   temporal feature builder;
-   random baseline;
-   walk-forward;
-   common metrics.

## Phase 4 --- Existing Models

-   integrate sklearn;
-   integrate Monte Carlo strategy;
-   audit/integrate LSTM;
-   integrate existing blend.

## Phase 5 --- PyTorch

-   baseline neural ranker;
-   temporal validation;
-   calibration.

## Phase 6 --- Continuous Learning

-   prediction snapshots;
-   evaluation after draw;
-   candidate training;
-   Champion/Challenger;
-   model registry.

## Phase 7 --- UI/API

-   number detail;
-   statistical dashboard;
-   model details;
-   prediction history;
-   backtest reports.

------------------------------------------------------------------------

# 78. Definition of Done

Sistemul final trebuie să poată funcționa fără intervenție manuală în
fluxul normal:

``` text
Rezultat oficial nou
        ↓
Scrape
        ↓
Validare + deduplicare
        ↓
Istoric actualizat
        ↓
Predicția precedentă evaluată
        ↓
Statistici recalculate
        ↓
Features actualizate
        ↓
Candidate ML recalibrat/antrenat
        ↓
Walk-forward validation
        ↓
Champion păstrat sau înlocuit
        ↓
Predicție pentru următoarea extragere
        ↓
Snapshot salvat
        ↓
API + UI actualizate
```

Utilizatorul trebuie să poată da click pe **oricare dintre cele 49 de
numere** și să vadă exact:

-   ce s-a observat;
-   ce era așteptat;
-   abaterea;
-   contribuția statistică;
-   istoricul;
-   gap-ul;
-   trendul;
-   relațiile;
-   semnificația ajustată;
-   scorurile fiecărui model;
-   contribuția la blend;
-   rank-ul predictiv;
-   incertitudinea;
-   explicația scorului.

------------------------------------------------------------------------

# 79. Principiul final

Proiectul trebuie să fie construit astfel încât să poată descoperi un
semnal dacă acesta există, dar și să poată spune corect **„nu există
dovezi suficiente"** dacă datele nu susțin ipoteza.

Complexitatea modelului nu este obiectivul.

Obiectivul este:

``` text
date curate
+ statistică corectă
+ zero leakage
+ backtesting temporal
+ comparație cu baseline
+ reproducibilitate
+ automatizare
+ transparență
```

Predicțiile sunt rezultate experimentale ale modelelor și
simulatoarelor, nu garanții privind extragerile viitoare.
