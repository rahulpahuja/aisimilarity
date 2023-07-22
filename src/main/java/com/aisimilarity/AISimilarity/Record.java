package com.aisimilarity.AISimilarity;

import javax.persistence.*;

@Entity
@Table(name="Records")
public class Record {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer record_id ;

    private Integer section_id;
    private Component component;

}
