#!/bin/sh
set -eu
# tag::deploy[]
tidewater build --release
tidewater check --strict
tidewater publish --channel stable
# end::deploy[]
echo "done"
