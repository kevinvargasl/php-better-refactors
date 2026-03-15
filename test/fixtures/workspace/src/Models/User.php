<?php

namespace App\Models;

use App\Contracts\HasName;
use App\Traits\HasFactory;

class User extends BaseModel implements HasName
{
    use HasFactory;

    public string $name;
    public ?string $email;

    public function __construct(string $name, ?string $email = null)
    {
        $this->name = $name;
        $this->email = $email;
    }

    public function getName(): string
    {
        return $this->name;
    }
}
