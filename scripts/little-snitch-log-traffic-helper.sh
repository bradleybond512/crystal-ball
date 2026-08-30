#!/bin/bash
set -euo pipefail

readonly LITTLE_SNITCH_BIN='/Library/PrivilegedHelperTools/com.crystalball.littlesnitch-cli'
readonly BEGIN_DATE="$(/bin/date -v-10M '+%Y-%m-%d %H:%M:%S')"

if [[ "$#" -ne 0 ]]; then
  echo 'This helper does not accept arguments' >&2
  exit 64
fi

readonly CALLER_UID="${SUDO_UID:-}"
readonly CALLER_USER="${SUDO_USER:-}"
if [[ ! "${CALLER_UID}" =~ ^[0-9]+$ || "${CALLER_UID}" -eq 0
      || ! "${CALLER_USER}" =~ ^[a-zA-Z0-9._-]{1,64}$ || "${CALLER_USER}" == 'root'
      || "$(/usr/bin/id -u -- "${CALLER_USER}" 2>/dev/null)" != "${CALLER_UID}" ]]; then
  echo 'Little Snitch caller identity is unavailable' >&2
  exit 77
fi

if [[ ! -x "${LITTLE_SNITCH_BIN}" ]]; then
  echo 'Little Snitch command-line tool is unavailable' >&2
  exit 69
fi

exec /usr/bin/perl -e '
  use strict;
  use warnings;
  use constant MAX_OUTPUT => 8 * 1024 * 1024 + 1;
  my @command = @ARGV;
  pipe(my $reader, my $writer) or die "unable to create bounded output pipe\n";
  my $child = fork();
  die "unable to start Little Snitch\n" unless defined $child;
  if ($child == 0) {
    close $reader;
    setpgrp(0, 0) or die "unable to isolate Little Snitch process\n";
    open STDOUT, ">&", $writer or die "unable to route Little Snitch output\n";
    close $writer;
    exec { $command[0] } @command;
    exit 126;
  }
  close $writer;
  my $terminate = sub {
    my ($exit_code) = @_;
    kill "TERM", -$child;
    select undef, undef, undef, 1.0;
    kill "KILL", -$child;
    waitpid($child, 0);
    alarm 0;
    exit $exit_code;
  };
  $SIG{ALRM} = sub { $terminate->(124) };
  $SIG{PIPE} = sub { $terminate->(141) };
  alarm 30;
  my $total = 0;
  while (1) {
    my $read = sysread($reader, my $chunk, 64 * 1024);
    $terminate->(74) unless defined $read;
    last if $read == 0;
    my $remaining = MAX_OUTPUT - $total;
    if ($read > $remaining) {
      print STDOUT substr($chunk, 0, $remaining) if $remaining > 0;
      $terminate->(74);
    }
    print STDOUT $chunk or $terminate->(141);
    $total += $read;
    $terminate->(74) if $total >= MAX_OUTPUT;
  }
  close $reader;
  waitpid($child, 0);
  alarm 0;
  my $status = $?;
  exit(($status & 127) ? 128 + ($status & 127) : ($status >> 8));
' -- "${LITTLE_SNITCH_BIN}" -u "${CALLER_UID}" log-traffic --begin-date "${BEGIN_DATE}"
