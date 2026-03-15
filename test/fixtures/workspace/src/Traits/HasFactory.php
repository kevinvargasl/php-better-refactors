<?php

namespace App\Traits;

trait HasFactory
{
    public static function factory(): static
    {
        return new static();
    }
}
