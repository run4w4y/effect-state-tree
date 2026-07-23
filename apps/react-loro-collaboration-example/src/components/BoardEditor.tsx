import { useAtom, useAtomValue } from '@effect/atom-react'
import * as stylex from '@stylexjs/stylex'
import { Option, Schema } from 'effect'
import { useState } from 'react'

import type { CollaborationAtoms } from '../client/atoms'
import type { CollaborationPeer } from '../client/peer'
import { CardColor, type Card as CardType } from '../domain/board'
import { colors, radii, spacing } from '../styles/tokens.stylex'
import { AsyncFailure } from './AsyncFailure'
import { Button } from './Button'
import { CommitFeed } from './CommitFeed'

const decodeColor = Schema.decodeUnknownOption(CardColor)

const styles = stylex.create({
  board: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 24px 80px rgba(33, 45, 39, 0.09)',
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    backgroundColor: colors.blueSoft,
    display: 'flex',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  identity: {
    display: 'grid',
    gap: '0.15rem',
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: '0.68rem',
    fontWeight: 850,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  },
  peerName: {
    fontFamily: 'Georgia, serif',
    fontSize: '2rem',
    fontWeight: 500,
    margin: 0,
  },
  revision: {
    display: 'grid',
    textAlign: 'right',
  },
  revisionNumber: {
    fontSize: '1.45rem',
  },
  section: {
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    padding: spacing.lg,
  },
  heading: {
    alignItems: 'center',
    display: 'flex',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  headingText: {
    display: 'grid',
    gap: '0.15rem',
  },
  title: {
    fontSize: '1.05rem',
    margin: 0,
  },
  compactActions: {
    display: 'flex',
    gap: spacing.xs,
  },
  cards: {
    display: 'grid',
    gap: spacing.sm,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  card: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderLeftStyle: 'solid',
    borderLeftWidth: 5,
    borderRadius: radii.md,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: spacing.sm,
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    padding: spacing.sm,
  },
  coral: { borderLeftColor: colors.coral },
  gold: { borderLeftColor: colors.gold },
  mint: { borderLeftColor: colors.mint },
  blue: { borderLeftColor: colors.blue },
  index: {
    alignItems: 'center',
    backgroundColor: '#e9eee8',
    borderRadius: radii.sm,
    color: colors.textMuted,
    display: 'flex',
    fontSize: '0.72rem',
    fontWeight: 850,
    height: '1.7rem',
    justifyContent: 'center',
    width: '1.7rem',
  },
  input: {
    backgroundColor: 'transparent',
    borderStyle: 'none',
    color: colors.text,
    minWidth: 0,
    outlineStyle: 'none',
    width: '100%',
  },
  cardActions: {
    display: 'flex',
    gap: '0.2rem',
  },
  form: {
    alignItems: 'center',
    backgroundColor: 'white',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: spacing.sm,
    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
    marginTop: spacing.md,
    padding: spacing.xs,
    paddingLeft: spacing.md,
  },
  select: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderStyle: 'solid',
    borderWidth: 1,
    color: colors.text,
    padding: spacing.sm,
  },
  notes: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    color: colors.text,
    display: 'block',
    lineHeight: 1.6,
    minHeight: '6rem',
    padding: spacing.md,
    whiteSpace: 'pre-wrap',
  },
  failures: {
    display: 'grid',
    gap: spacing.sm,
    padding: spacing.lg,
  },
})

const colorStyle = (color: CardType['color']) => styles[color]

export const BoardEditor = ({
  atoms,
  peer,
}: {
  readonly atoms: CollaborationAtoms
  readonly peer: CollaborationPeer
}) => {
  const cards = useAtomValue(atoms.cards)
  const notes = useAtomValue(atoms.notes)
  const revision = useAtomValue(atoms.revision)
  const [moveResult, move] = useAtom(atoms.actions.move)
  const [renameResult, rename] = useAtom(atoms.actions.rename)
  const [addResult, add] = useAtom(atoms.actions.add)
  const [removeResult, remove] = useAtom(atoms.actions.remove)
  const [appendResult, append] = useAtom(atoms.actions.append)
  const [deleteResult, deleteCharacter] = useAtom(atoms.actions.deleteCharacter)
  const [undoResult, undo] = useAtom(atoms.actions.undo)
  const [redoResult, redo] = useAtom(atoms.actions.redo)
  const [cardTitle, setCardTitle] = useState('')
  const [cardColor, setCardColor] = useState<CardType['color']>('blue')
  const [note, setNote] = useState('')

  return (
    <article
      {...stylex.props(styles.board)}
      aria-label={`Shared board for ${peer.name}`}
      data-testid="collaboration-board"
    >
      <header {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.identity)}>
          <span {...stylex.props(styles.eyebrow)}>
            Independent browser peer
          </span>
          <h2 {...stylex.props(styles.peerName)}>{peer.name}</h2>
        </span>
        <span {...stylex.props(styles.revision)}>
          <strong {...stylex.props(styles.revisionNumber)}>{revision}</strong>
          <span {...stylex.props(styles.eyebrow)}>revision</span>
        </span>
      </header>

      <section {...stylex.props(styles.section)}>
        <header {...stylex.props(styles.heading)}>
          <span {...stylex.props(styles.headingText)}>
            <span {...stylex.props(styles.eyebrow)}>LoroMovableList</span>
            <h3 {...stylex.props(styles.title)}>Intent-preserving cards</h3>
          </span>
          <span {...stylex.props(styles.compactActions)}>
            <Button compact onClick={() => undo(undefined)}>
              Undo mine
            </Button>
            <Button compact onClick={() => redo(undefined)}>
              Redo
            </Button>
          </span>
        </header>

        <ol {...stylex.props(styles.cards)}>
          {cards.map((card, index) => (
            <li
              key={card.id}
              {...stylex.props(styles.card, colorStyle(card.color))}
            >
              <span {...stylex.props(styles.index)}>{index + 1}</span>
              <input
                {...stylex.props(styles.input)}
                aria-label={`Rename ${card.title}`}
                value={card.title}
                onChange={(event) =>
                  rename({ id: card.id, title: event.target.value })
                }
              />
              <span {...stylex.props(styles.cardActions)}>
                <Button
                  aria-label={`Move ${card.title} left`}
                  compact
                  disabled={index === 0}
                  onClick={() => move({ id: card.id, offset: -1 })}
                >
                  ←
                </Button>
                <Button
                  aria-label={`Move ${card.title} right`}
                  compact
                  disabled={index === cards.length - 1}
                  onClick={() => move({ id: card.id, offset: 1 })}
                >
                  →
                </Button>
                <Button
                  aria-label={`Remove ${card.title}`}
                  compact
                  onClick={() => remove(card.id)}
                  tone="danger"
                >
                  ×
                </Button>
              </span>
            </li>
          ))}
        </ol>

        <form
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault()
            const title = cardTitle.trim()
            if (title.length === 0) return
            add({ title, color: cardColor })
            setCardTitle('')
          }}
        >
          <input
            {...stylex.props(styles.input)}
            aria-label="New card title"
            onChange={(event) => setCardTitle(event.target.value)}
            placeholder="Add a shared card"
            value={cardTitle}
          />
          <select
            {...stylex.props(styles.select)}
            aria-label="Card color"
            onChange={(event) => {
              const decoded = decodeColor(event.target.value)
              if (Option.isSome(decoded)) setCardColor(decoded.value)
            }}
            value={cardColor}
          >
            {CardColor.literals.map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
          <Button disabled={addResult.waiting} tone="primary" type="submit">
            Add
          </Button>
        </form>
      </section>

      <section {...stylex.props(styles.section)}>
        <header {...stylex.props(styles.heading)}>
          <span {...stylex.props(styles.headingText)}>
            <span {...stylex.props(styles.eyebrow)}>LoroText</span>
            <h3 {...stylex.props(styles.title)}>Collaborative notes</h3>
          </span>
          <Button
            compact
            disabled={notes.length === 0}
            onClick={() => deleteCharacter(undefined)}
          >
            Delete last
          </Button>
        </header>
        <output {...stylex.props(styles.notes)}>
          {notes || 'Empty shared text'}
        </output>
        <form
          {...stylex.props(styles.form)}
          onSubmit={(event) => {
            event.preventDefault()
            if (note.length === 0) return
            append(`${note} `)
            setNote('')
          }}
        >
          <input
            {...stylex.props(styles.input)}
            aria-label="Text to append"
            onChange={(event) => setNote(event.target.value)}
            placeholder="Append text as this peer"
            value={note}
          />
          <span />
          <Button disabled={appendResult.waiting} tone="primary" type="submit">
            Insert
          </Button>
        </form>
      </section>

      <div {...stylex.props(styles.failures)}>
        <AsyncFailure result={addResult} />
        <AsyncFailure result={moveResult} />
        <AsyncFailure result={renameResult} />
        <AsyncFailure result={removeResult} />
        <AsyncFailure result={appendResult} />
        <AsyncFailure result={deleteResult} />
        <AsyncFailure result={undoResult} />
        <AsyncFailure result={redoResult} />
      </div>

      <section {...stylex.props(styles.section)}>
        <header {...stylex.props(styles.heading)}>
          <span {...stylex.props(styles.headingText)}>
            <span {...stylex.props(styles.eyebrow)}>Patch envelope</span>
            <h3 {...stylex.props(styles.title)}>Commit feed</h3>
          </span>
        </header>
        <CommitFeed atoms={atoms} />
      </section>
    </article>
  )
}
