# Sample: three public-domain hymns

Three short hymns, first as **song text** (text format 1,
[`text-format.md`](text-format.md)), then as the **format 1** files they become
([SDD-0002](../design/0002-content-format.md)). The JSON was checked against the
published schema and the repository's validator. The text was run through
`bun run text` (with the book fields given under "What it becomes"), and its
output equals the JSON below.

All three are public domain. Newton (died 1807), Heber (died 1826), Watts
(died 1748) and Hudson (died 1906) are long out of copyright anywhere, and the
texts are the traditional hymnal wording. Do not take this to cover any other
version: a modern hymnal's altered text may be under copyright.

## The text

One file, three songs, separated by `---`. The first lines are comments.

```text
# Public domain: texts by Newton (d. 1807), Heber (d. 1826), Watts (d. 1748)
# and Hudson (d. 1906).
1. Amazing Grace
Author: John Newton
Tune: New Britain
Meter: 8.6.8.6

Amazing grace! how sweet the sound,
That saved a wretch like me!
I once was lost, but now am found,
Was blind, but now I see.

'Twas grace that taught my heart to fear,
And grace my fears relieved;
How precious did that grace appear
The hour I first believed.

Through many dangers, toils, and snares,
I have already come;
'Tis grace hath brought me safe thus far,
And grace will lead me home.

The Lord has promised good to me,
His word my hope secures;
He will my shield and portion be,
As long as life endures.
---

2. Holy, Holy, Holy
Author: Reginald Heber
Tune: Nicaea
Meter: 11.12.12.10

Holy, holy, holy! Lord God Almighty!
Early in the morning our song shall rise to Thee;
Holy, holy, holy! merciful and mighty,
God in three Persons, blessed Trinity!

Holy, holy, holy! all the saints adore Thee,
Casting down their golden crowns around the glassy sea;
Cherubim and seraphim falling down before Thee,
Which wert, and art, and evermore shalt be.

Holy, holy, holy! though the darkness hide Thee,
Though the eye of sinful man Thy glory may not see,
Only Thou art holy; there is none beside Thee,
Perfect in power, in love, and purity.

Holy, holy, holy! Lord God Almighty!
All Thy works shall praise Thy name, in earth, and sky, and sea;
Holy, holy, holy! merciful and mighty,
God in three Persons, blessed Trinity!
---

3. Alas! and did my Saviour bleed
Author: Isaac Watts; refrain by Ralph E. Hudson
Tune: Hudson
Meter: C.M. with refrain

Alas! and did my Saviour bleed,
And did my Sovereign die?
Would He devote that sacred head
For such a worm as I?

Chorus:
At the cross, at the cross where I first saw the light,
And the burden of my heart rolled away,
It was there by faith I received my sight,
And now I am happy all the day!

Was it for crimes that I have done,
He groaned upon the tree?
Amazing pity! grace unknown!
And love beyond degree!

Chorus:
```

What to see in it:

- Songs 1 and 2 have only unlabelled blocks, so they are stanzas `1` to `4`, and
  with no chorus the sung order is the order printed.
- Song 3 prints its refrain once, after the first stanza, and then writes
  `Chorus:` alone under the second. That label with no lines is a reference: the
  chorus sung again. Because the song has a reference, the sung order is the
  order as printed: stanza 1, chorus, stanza 2, chorus.
- A `Sequence:` line is not needed anywhere; see section 2.5 of the format for
  when one is.

## What it becomes

The book needs its own fields, which the text does not carry. Here they were
`id` `sample-public-domain`, `title` `Sample hymns`, `language` `en`, `script`
`Latn`.

`hymnbook.json`:

```json
{
  "format": 1,
  "id": "sample-public-domain",
  "title": "Sample hymns",
  "language": "en",
  "script": "Latn",
  "hymnCount": 3
}
```

`0001.json`:

```json
{
  "number": 1,
  "title": "Amazing Grace",
  "meta": {
    "author": "John Newton",
    "tune": "New Britain",
    "meter": "8.6.8.6"
  },
  "parts": [
    {
      "id": "s1",
      "kind": "stanza",
      "label": "1",
      "lines": [
        "Amazing grace! how sweet the sound,",
        "That saved a wretch like me!",
        "I once was lost, but now am found,",
        "Was blind, but now I see."
      ]
    },
    {
      "id": "s2",
      "kind": "stanza",
      "label": "2",
      "lines": [
        "'Twas grace that taught my heart to fear,",
        "And grace my fears relieved;",
        "How precious did that grace appear",
        "The hour I first believed."
      ]
    },
    {
      "id": "s3",
      "kind": "stanza",
      "label": "3",
      "lines": [
        "Through many dangers, toils, and snares,",
        "I have already come;",
        "'Tis grace hath brought me safe thus far,",
        "And grace will lead me home."
      ]
    },
    {
      "id": "s4",
      "kind": "stanza",
      "label": "4",
      "lines": [
        "The Lord has promised good to me,",
        "His word my hope secures;",
        "He will my shield and portion be,",
        "As long as life endures."
      ]
    }
  ],
  "sequence": [
    {
      "partId": "s1"
    },
    {
      "partId": "s2"
    },
    {
      "partId": "s3"
    },
    {
      "partId": "s4"
    }
  ]
}
```

`0002.json`:

```json
{
  "number": 2,
  "title": "Holy, Holy, Holy",
  "meta": {
    "author": "Reginald Heber",
    "tune": "Nicaea",
    "meter": "11.12.12.10"
  },
  "parts": [
    {
      "id": "s1",
      "kind": "stanza",
      "label": "1",
      "lines": [
        "Holy, holy, holy! Lord God Almighty!",
        "Early in the morning our song shall rise to Thee;",
        "Holy, holy, holy! merciful and mighty,",
        "God in three Persons, blessed Trinity!"
      ]
    },
    {
      "id": "s2",
      "kind": "stanza",
      "label": "2",
      "lines": [
        "Holy, holy, holy! all the saints adore Thee,",
        "Casting down their golden crowns around the glassy sea;",
        "Cherubim and seraphim falling down before Thee,",
        "Which wert, and art, and evermore shalt be."
      ]
    },
    {
      "id": "s3",
      "kind": "stanza",
      "label": "3",
      "lines": [
        "Holy, holy, holy! though the darkness hide Thee,",
        "Though the eye of sinful man Thy glory may not see,",
        "Only Thou art holy; there is none beside Thee,",
        "Perfect in power, in love, and purity."
      ]
    },
    {
      "id": "s4",
      "kind": "stanza",
      "label": "4",
      "lines": [
        "Holy, holy, holy! Lord God Almighty!",
        "All Thy works shall praise Thy name, in earth, and sky, and sea;",
        "Holy, holy, holy! merciful and mighty,",
        "God in three Persons, blessed Trinity!"
      ]
    }
  ],
  "sequence": [
    {
      "partId": "s1"
    },
    {
      "partId": "s2"
    },
    {
      "partId": "s3"
    },
    {
      "partId": "s4"
    }
  ]
}
```

`0003.json`:

```json
{
  "number": 3,
  "title": "Alas! and did my Saviour bleed",
  "meta": {
    "author": "Isaac Watts; refrain by Ralph E. Hudson",
    "tune": "Hudson",
    "meter": "C.M. with refrain"
  },
  "parts": [
    {
      "id": "s1",
      "kind": "stanza",
      "label": "1",
      "lines": [
        "Alas! and did my Saviour bleed,",
        "And did my Sovereign die?",
        "Would He devote that sacred head",
        "For such a worm as I?"
      ]
    },
    {
      "id": "c1",
      "kind": "chorus",
      "lines": [
        "At the cross, at the cross where I first saw the light,",
        "And the burden of my heart rolled away,",
        "It was there by faith I received my sight,",
        "And now I am happy all the day!"
      ]
    },
    {
      "id": "s2",
      "kind": "stanza",
      "label": "2",
      "lines": [
        "Was it for crimes that I have done,",
        "He groaned upon the tree?",
        "Amazing pity! grace unknown!",
        "And love beyond degree!"
      ]
    }
  ],
  "sequence": [
    {
      "partId": "s1"
    },
    {
      "partId": "c1"
    },
    {
      "partId": "s2"
    },
    {
      "partId": "c1"
    }
  ]
}
```

Part ids (`s1`, `c1`) are assigned by the parser and mean nothing outside their
hymn. Song 3's `sequence` names `c1` twice and every part at least once, as
format 1 requires.

## Try it

Put `hymnbook.json` and the three hymn files in a directory named for the book's
`id`, and pack it:

```sh
bun run pack path/to/sample-public-domain
```

A good book prints `packed ...`. Load the resulting file in the Library
([how to check it](README.md#how-to-check-it)).
